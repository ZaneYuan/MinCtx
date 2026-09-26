'use strict';
const fs = require('fs');

// Claude Code transcripts are JSONL. Main-chain assistant entries carry message.usage;
// subagent entries are marked isSidechain. A compaction writes a compact_boundary entry.

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Partial first line of a tail read, or a line being written.
    }
  }
  return out;
}

function readTail(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return { text: buf.toString('utf8'), whole: start === 0 };
  } finally {
    fs.closeSync(fd);
  }
}

function isCompactBoundary(e) {
  return e.subtype === 'compact_boundary' || e.isCompactSummary === true;
}

function usageTokens(u) {
  return (
    (u.input_tokens || 0) +
    (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0) +
    (u.output_tokens || 0)
  );
}

// Size of the conversation as of the last main-chain request: what the next prompt will carry.
// Returns 0 when unknown (no transcript, fresh session, or right after a compaction).
function contextTokens(file) {
  if (!file || !fs.existsSync(file)) return 0;
  for (const bytes of [256 * 1024, 4 * 1024 * 1024, Infinity]) {
    const { text, whole } = readTail(file, bytes);
    const entries = parseLines(text);
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (isCompactBoundary(e)) return 0;
      if (e.type === 'assistant' && !e.isSidechain && e.message && e.message.usage) {
        return usageTokens(e.message.usage);
      }
    }
    if (whole) return 0;
  }
  return 0;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n');
  }
  return '';
}

// A real user prompt: typed text, not a tool result, command echo or injected reminder.
function userPromptText(e) {
  if (e.type !== 'user' || e.isSidechain || e.isMeta || !e.message) return null;
  const c = e.message.content;
  if (Array.isArray(c) && c.some((x) => x && x.type === 'tool_result')) return null;
  const t = textOf(c).trim();
  if (!t || t.startsWith('<')) return null;
  return t;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const TEST_RE = /\b(test|tests|pytest|jest|vitest|mocha|cargo test|go test|dotnet test|mvn|gradle|rspec|phpunit|tsc|lint|build)\b/i;

function resultText(content) {
  if (typeof content === 'string') return content;
  return textOf(content);
}

// One pass over the whole transcript. Used for handoff and stats, never on the hot path.
function summarize(file) {
  const s = {
    prompts: [],
    modified: [],
    reads: [],
    commands: [],
    toolCalls: 0,
    toolCallsByName: {},
    requests: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    contextTokens: 0,
    compactions: 0,
  };
  if (!file || !fs.existsSync(file)) return s;
  const entries = parseLines(fs.readFileSync(file, 'utf8'));
  const pending = new Map(); // tool_use_id -> record awaiting its result
  const modified = new Set();
  const seenMsg = new Set();

  for (const e of entries) {
    if (isCompactBoundary(e)) {
      s.compactions++;
      s.contextTokens = 0;
      continue;
    }
    const p = userPromptText(e);
    if (p) s.prompts.push(p);

    if (e.type === 'assistant' && e.message) {
      const m = e.message;
      // One API response can be split across several entries sharing an id; count usage once.
      const key = m.id || e.requestId || e.uuid;
      if (m.usage && !seenMsg.has(key)) {
        seenMsg.add(key);
        s.requests++;
        s.input += m.usage.input_tokens || 0;
        s.cacheRead += m.usage.cache_read_input_tokens || 0;
        s.cacheWrite += m.usage.cache_creation_input_tokens || 0;
        s.output += m.usage.output_tokens || 0;
        if (!e.isSidechain) s.contextTokens = usageTokens(m.usage);
      }
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (!c || c.type !== 'tool_use') continue;
        s.toolCalls++;
        s.toolCallsByName[c.name] = (s.toolCallsByName[c.name] || 0) + 1;
        const inp = c.input || {};
        if (EDIT_TOOLS.has(c.name)) {
          const f = inp.file_path || inp.notebook_path;
          if (f) modified.add(f);
        } else if (c.name === 'Read' && inp.file_path) {
          const r = { file: inp.file_path, ranged: inp.offset != null || inp.limit != null, lines: 0 };
          s.reads.push(r);
          pending.set(c.id, r);
        } else if (c.name === 'Bash' && inp.command) {
          const r = { command: inp.command, error: false };
          s.commands.push(r);
          pending.set(c.id, r);
        }
      }
    }

    if (e.type === 'user' && e.message && Array.isArray(e.message.content)) {
      for (const c of e.message.content) {
        if (!c || c.type !== 'tool_result' || !pending.has(c.tool_use_id)) continue;
        const r = pending.get(c.tool_use_id);
        pending.delete(c.tool_use_id);
        if ('lines' in r) {
          // A denied or failed Read (e.g. narrowed by the read guard) loaded no file content.
          if (c.is_error === true) r.failed = true;
          else r.lines = resultText(c.content).split('\n').length;
        }
        if ('error' in r) r.error = c.is_error === true;
      }
    }
  }
  s.modified = [...modified];
  s.reads = s.reads.filter((r) => !r.failed);
  s.tests = s.commands.filter((c) => TEST_RE.test(c.command));
  return s;
}

module.exports = { contextTokens, summarize, parseLines, userPromptText, usageTokens };
