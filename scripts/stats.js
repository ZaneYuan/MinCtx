#!/usr/bin/env node
'use strict';
// Context-efficiency report for a session. Usage: stats.js [transcript.jsonl] [--json]
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { summarize } = require('./lib/transcript');
const st = require('./lib/state');

function findProjectDir(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.minctx'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

function fmt(n) {
  const trim = (x) => x.replace(/\.0+$/, '');
  if (n >= 1e6) return trim((n / 1e6).toFixed(2)) + 'M';
  if (n >= 1e3) return trim((n / 1e3).toFixed(1)) + 'K';
  return String(n);
}

function guardEvents(projectDir, sessionId) {
  const counts = { narrowed: 0, shadowReads: 0, rollovers: 0, handoffs: 0 };
  let text = '';
  try {
    text = fs.readFileSync(st.paths(projectDir).log, 'utf8');
  } catch {
    return counts;
  }
  for (const line of text.split('\n')) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (sessionId && e.session !== sessionId) continue;
    if (e.event === 'read_guard') e.action === 'deny' ? counts.narrowed++ : counts.shadowReads++;
    if (e.event === 'rollover' && e.action === 'block') counts.rollovers++;
    if (e.event === 'handoff_loaded') counts.handoffs++;
  }
  return counts;
}

function report(transcriptPath, projectDir, sessionId) {
  const cfg = loadConfig(projectDir);
  const s = summarize(transcriptPath);
  const files = new Set(s.reads.map((r) => r.file));
  const lines = s.reads.reduce((a, r) => a + r.lines, 0);
  const ranged = s.reads.filter((r) => r.ranged).length;
  const byTool = Object.entries(s.toolCallsByName)
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `${n} ${c}`)
    .join(', ');
  const g = guardEvents(projectDir, sessionId);
  const totalIn = s.input + s.cacheRead + s.cacheWrite;
  return {
    session: sessionId,
    contextTokens: s.contextTokens,
    requests: s.requests,
    inputTotal: totalIn,
    inputNew: s.input,
    cacheWrite: s.cacheWrite,
    cacheRead: s.cacheRead,
    output: s.output,
    toolCalls: s.toolCalls,
    toolCallsByName: s.toolCallsByName,
    reads: s.reads.length,
    filesRead: files.size,
    linesRead: lines,
    rangedReads: ranged,
    compactions: s.compactions,
    guard: g,
    text: [
      `MinCtx stats · session ${(sessionId || '?').slice(0, 8)}`,
      `Context now      ${fmt(s.contextTokens)} tokens (soft ${fmt(cfg.rollover.softTokens)} · hard ${fmt(cfg.rollover.hardTokens)})`,
      `Requests         ${s.requests}`,
      `Input processed  ${fmt(totalIn)} (new ${fmt(s.input)} · cache write ${fmt(s.cacheWrite)} · cache read ${fmt(s.cacheRead)})`,
      `Output           ${fmt(s.output)}`,
      `Tool calls       ${s.toolCalls}${byTool ? ` (${byTool})` : ''}`,
      `Reads            ${s.reads.length} of ${files.size} files, ~${lines} lines (ranged ${ranged} · full ${s.reads.length - ranged})`,
      `Guard            ${g.narrowed} reads narrowed · ${g.rollovers} rollovers · ${g.handoffs} handoffs loaded` +
        (g.shadowReads ? ` · ${g.shadowReads} shadow` : ''),
      s.compactions ? `Compactions      ${s.compactions}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  let transcript = args.find((a) => !a.startsWith('--'));
  const projectDir = findProjectDir(process.cwd());
  let sessionId = null;
  if (!transcript) {
    const last = st.readJson(st.paths(projectDir).last, null);
    if (!last || !last.transcriptPath) {
      console.log('MinCtx: no session recorded yet in this project (.minctx/last.json). Pass a transcript path.');
      process.exitCode = 1;
      return;
    }
    transcript = last.transcriptPath;
    sessionId = last.sessionId;
  } else {
    sessionId = path.basename(transcript, '.jsonl');
  }
  const r = report(transcript, projectDir, sessionId);
  if (asJson) {
    delete r.text;
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(r.text);
  }
}

if (require.main === module) main();
module.exports = { report, fmt };
