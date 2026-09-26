'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.pdf', '.ipynb',
]);
const MAX_SCAN_BYTES = 4 * 1024 * 1024;

// Declarations worth listing in an outline, across common languages.
const DECL_RE = new RegExp(
  '^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:(?:public|private|protected|internal|static|abstract|sealed|partial|override|virtual|final|pub(?:\\(crate\\))?)\\s+)*' +
    '(?:function\\*?|class|interface|enum|struct|record|trait|impl|type|def|fn|func|module|namespace|' +
    'const\\s+\\w+\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|\\w+)\\s*=>|' +
    '(?:[\\w<>\\[\\],?]+\\s+)+\\w+\\s*\\([^;]*$)',
);
const HEADING_RE = /^#{1,3}\s+\S/;

function lineInfo(file) {
  const st = fs.statSync(file);
  if (!st.isFile()) return null;
  if (st.size > MAX_SCAN_BYTES) return { lines: Math.round(st.size / 40), text: null, size: st.size };
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8192).includes(0)) return null; // binary
  const text = buf.toString('utf8');
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  if (text.endsWith('\n')) lines--;
  return { lines, text, size: st.size };
}

const DOC_EXT = new Set(['.md', '.markdown', '.mdx', '.rst', '.txt']);

// Every declaration/heading line, as "L<n>: <text>".
function collectOutline(text, ext) {
  const out = [];
  const lines = text.split('\n');
  const md = DOC_EXT.has(ext);
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (md && /^\s*(```|~~~)/.test(l)) fenced = !fenced;
    if (fenced || l.length > 300) continue;
    if ((md && HEADING_RE.test(l)) || (!md && DECL_RE.test(l) && !/^\s*(return|if|for|while|switch|else|catch)\b/.test(l))) {
      out.push(`L${i + 1}: ${l.trim().slice(0, 90)}`);
    }
  }
  return out;
}

function outline(text, maxEntries, ext) {
  return collectOutline(text, ext).slice(0, maxEntries);
}

function denyMessage(file, info, cfg, viaShell) {
  const max = cfg.readGuard.maxLines;
  const parts = [
    `MinCtx: ${path.basename(file)} has ${info.lines} lines (limit ${max} per unbounded read).`,
    'Locate what you need (Grep -n for the symbol, or use the outline below), then Read with offset/limit.',
  ];
  if (info.text) {
    const all = collectOutline(info.text, path.extname(file).toLowerCase());
    const shown = all.slice(0, cfg.readGuard.outlineEntries);
    if (shown.length) {
      parts.push('Outline:\n' + shown.join('\n'));
      if (all.length > shown.length) {
        parts.push(`...${all.length - shown.length} more entries after ${shown[shown.length - 1].split(':')[0]} not shown; Grep -n for the symbol you need.`);
      }
    }
  }
  parts.push(
    viaShell
      ? `If the whole file is truly required, use Read with offset: 1, limit: ${info.lines}.`
      : `If the whole file is truly required, re-issue Read with offset: 1, limit: ${info.lines}.`,
  );
  return parts.join('\n');
}

function fileInfo(filePath, cwd) {
  const file = path.resolve(cwd || process.cwd(), filePath);
  if (SKIP_EXT.has(path.extname(file).toLowerCase())) return null;
  try {
    const info = lineInfo(file);
    return info ? { file, ...info } : null;
  } catch {
    return null; // Missing/unreadable: let the tool report it.
  }
}

// Returns null to allow, or { file, lines, reason } for a read that should be narrowed.
function checkRead(toolInput, cwd, cfg) {
  const inp = toolInput || {};
  if (!inp.file_path || inp.offset != null || inp.limit != null || inp.pages != null) return null;
  const info = fileInfo(inp.file_path, cwd);
  if (!info || info.lines <= cfg.readGuard.maxLines) return null;
  return { file: info.file, lines: info.lines, reason: denyMessage(info.file, info, cfg, false) };
}

// --- Shell commands that dump a file into context ---------------------------------------------
// Only simple single commands are judged. Pipelines, chains, redirects and substitutions pass:
// `cat f | grep x` or `sed -n '1,2000p' f | head` are already narrowed by the user of the output.

function tokenize(cmd) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (const ch of cmd.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) tokens.push(cur);
      cur = '';
      has = false;
    } else if ('|;&<>`$(){}'.includes(ch)) {
      return null;
    } else {
      cur += ch;
    }
  }
  if (quote) return null;
  if (has || cur) tokens.push(cur);
  return tokens;
}

const toInt = (s) => (/^\d+$/.test(s) ? Number(s) : null);

// Each reader returns { file, span(totalLines) } or null when the command is not a plain file dump.
const READERS = {
  // cat / nl / more / less [flags] FILE
  whole(args) {
    const files = args.filter((a) => !a.startsWith('-'));
    return files.length === 1 ? { file: files[0], span: (n) => n } : null;
  },
  // head/tail [-n N | -N | --lines=N | -n +K] FILE
  headTail(args, isTail) {
    let count = 10;
    let fromLine = null;
    const files = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      let v = null;
      if (a === '-n' || a === '--lines') v = args[++i];
      else if (a.startsWith('--lines=')) v = a.slice(8);
      else if (/^-n\+?\d+$/.test(a)) v = a.slice(2);
      else if (/^-\d+$/.test(a)) v = a.slice(1);
      else if (a.startsWith('-')) continue;
      else {
        files.push(a);
        continue;
      }
      if (v == null) return null;
      if (isTail && v.startsWith('+') && toInt(v.slice(1)) != null) fromLine = toInt(v.slice(1));
      else if (toInt(v) != null) count = toInt(v);
      else return null;
    }
    if (files.length !== 1) return null;
    return { file: files[0], span: (n) => (fromLine != null ? Math.max(0, n - fromLine + 1) : Math.min(count, n)) };
  },
  // sed -n 'A,Bp' FILE  |  sed -n 'Ap' FILE
  sed(args) {
    const rest = args.filter((a) => a !== '-n');
    if (rest.length !== 2 || rest.length === args.length) return null;
    const m = /^(\d+)(?:,(\d+|\$))?p$/.exec(rest[0]);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2];
    return { file: rest[1], span: (n) => (b === undefined ? 1 : b === '$' ? Math.max(0, n - a + 1) : Math.max(0, Number(b) - a + 1)) };
  },
  // Get-Content/gc/cat/type [-Path] FILE [-TotalCount|-Head|-First|-Tail N]
  powershell(args) {
    let file = null;
    let count = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const lower = a.toLowerCase();
      if (['-totalcount', '-head', '-first', '-tail', '-last'].includes(lower)) {
        count = toInt(args[++i] || '');
        if (count == null) return null;
      } else if (['-path', '-literalpath', '-lp'].includes(lower)) {
        file = args[++i];
      } else if (lower.startsWith('-')) {
        if (['-encoding', '-delimiter', '-readcount', '-stream'].includes(lower)) i++;
      } else if (file == null) {
        file = a;
      } else {
        return null;
      }
    }
    if (!file) return null;
    return { file, span: (n) => (count == null ? n : Math.min(count, n)) };
  },
};

function parseReader(tokens, shell) {
  if (!tokens || !tokens.length) return null;
  const [cmd, ...args] = tokens;
  const c = cmd.toLowerCase();
  if (shell === 'powershell') {
    if (['get-content', 'gc', 'cat', 'type'].includes(c)) return READERS.powershell(args);
    return null;
  }
  if (['cat', 'nl', 'more', 'less', 'bat'].includes(c)) return READERS.whole(args);
  if (c === 'head') return READERS.headTail(args, false);
  if (c === 'tail') return READERS.headTail(args, true);
  if (c === 'sed') return READERS.sed(args);
  return null;
}

// shell: 'bash' (Bash tool) or 'powershell' (PowerShell tool).
function checkShell(toolInput, cwd, cfg, shell = 'bash') {
  const reader = parseReader(tokenize((toolInput && toolInput.command) || ''), shell);
  if (!reader) return null;
  const info = fileInfo(reader.file, cwd);
  const max = cfg.readGuard.maxLines;
  if (!info || info.lines <= max || reader.span(info.lines) <= max) return null;
  return { file: info.file, lines: info.lines, reason: denyMessage(info.file, info, cfg, true) };
}

const checkBash = (toolInput, cwd, cfg) => checkShell(toolInput, cwd, cfg, 'bash');
const checkPowerShell = (toolInput, cwd, cfg) => checkShell(toolInput, cwd, cfg, 'powershell');

module.exports = { checkRead, checkBash, checkPowerShell, outline, lineInfo, tokenize };
