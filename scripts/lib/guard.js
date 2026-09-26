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

function outline(text, maxEntries, ext) {
  const out = [];
  const lines = text.split('\n');
  const md = DOC_EXT.has(ext);
  let fenced = false;
  for (let i = 0; i < lines.length && out.length < maxEntries; i++) {
    const l = lines[i];
    if (md && /^\s*(```|~~~)/.test(l)) fenced = !fenced;
    if (fenced || l.length > 300) continue;
    if ((md && HEADING_RE.test(l)) || (!md && DECL_RE.test(l) && !/^\s*(return|if|for|while|switch|else|catch)\b/.test(l))) {
      out.push(`L${i + 1}: ${l.trim().slice(0, 90)}`);
    }
  }
  return out;
}

function denyMessage(file, info, cfg) {
  const max = cfg.readGuard.maxLines;
  const parts = [
    `MinCtx: ${path.basename(file)} has ${info.lines} lines (limit ${max} per unbounded read).`,
    'Locate what you need (Grep -n for the symbol, or use the outline below), then Read with offset/limit.',
  ];
  if (info.text) {
    const o = outline(info.text, cfg.readGuard.outlineEntries, path.extname(file).toLowerCase());
    if (o.length) parts.push('Outline:\n' + o.join('\n'));
  }
  parts.push(`If the whole file is truly required, re-issue Read with offset: 1, limit: ${info.lines}.`);
  return parts.join('\n');
}

// Returns null to allow, or { file, lines, reason } for a read that should be narrowed.
function checkRead(toolInput, cwd, cfg) {
  const inp = toolInput || {};
  if (!inp.file_path || inp.offset != null || inp.limit != null || inp.pages != null) return null;
  const file = path.resolve(cwd || process.cwd(), inp.file_path);
  if (SKIP_EXT.has(path.extname(file).toLowerCase())) return null;
  let info;
  try {
    info = lineInfo(file);
  } catch {
    return null; // Missing/unreadable: let the tool report it.
  }
  if (!info || info.lines <= cfg.readGuard.maxLines) return null;
  return { file, lines: info.lines, reason: denyMessage(file, info, cfg) };
}

// `cat big.file` (single file, no pipes/redirects) is an unbounded read by another name.
const CAT_RE = /^\s*(?:cat|more|less)\s+("[^"]+"|'[^']+'|[^\s|;&<>()$`*?]+)\s*$/;

function checkBash(toolInput, cwd, cfg) {
  const m = CAT_RE.exec((toolInput && toolInput.command) || '');
  if (!m) return null;
  const target = m[1].replace(/^["']|["']$/g, '');
  const hit = checkRead({ file_path: target }, cwd, cfg);
  if (!hit) return null;
  return { ...hit, reason: hit.reason.replace('re-issue Read', 'use Read') };
}

// PowerShell equivalents: `Get-Content file`, `gc`, `cat`, `type`, with no -TotalCount/-Head/-Tail or pipeline.
const PS_RE = /^\s*(?:Get-Content|gc|cat|type)\s+(?:-(?:Path|LiteralPath)\s+)?("[^"]+"|'[^']+'|[^\s|;&<>()$`*?]+)\s*$/i;

function checkPowerShell(toolInput, cwd, cfg) {
  const m = PS_RE.exec((toolInput && toolInput.command) || '');
  if (!m) return null;
  const target = m[1].replace(/^["']|["']$/g, '');
  const hit = checkRead({ file_path: target }, cwd, cfg);
  if (!hit) return null;
  return { ...hit, reason: hit.reason.replace('re-issue Read', 'use Read') };
}

module.exports = { checkRead, checkBash, checkPowerShell, outline, lineInfo };
