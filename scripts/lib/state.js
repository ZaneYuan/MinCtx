'use strict';
const fs = require('fs');
const path = require('path');
const { summarize } = require('./transcript');

// Everything MinCtx persists lives in <project>/.minctx/ (self-gitignored).
function paths(projectDir) {
  const dir = path.join(projectDir, '.minctx');
  return {
    dir,
    state: path.join(dir, 'state.md'),
    handoff: path.join(dir, 'handoff.md'),
    handoffMeta: path.join(dir, 'handoff.json'),
    last: path.join(dir, 'last.json'),
    sessions: path.join(dir, 'sessions.json'),
    log: path.join(dir, 'log.jsonl'),
  };
}

function ensureDir(projectDir) {
  const p = paths(projectDir);
  fs.mkdirSync(p.dir, { recursive: true });
  const gi = path.join(p.dir, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
  return p;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function log(projectDir, event) {
  try {
    const p = ensureDir(projectDir);
    fs.appendFileSync(p.log, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  } catch {
    // Logging must never break a hook.
  }
}

// Per-session flags (e.g. soft warning already shown). Keeps the newest 50 sessions.
function sessionFlags(projectDir, sessionId, update) {
  const p = ensureDir(projectDir);
  const all = readJson(p.sessions, {});
  if (update) {
    all[sessionId] = { ...(all[sessionId] || {}), ...update, at: Date.now() };
    const keep = Object.entries(all)
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, 50);
    writeJson(p.sessions, Object.fromEntries(keep));
  }
  return all[sessionId] || {};
}

function clip(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function rel(projectDir, f) {
  const r = path.relative(projectDir, f);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : f;
}

// Conversation -> executable state. Only what the repo can't tell a fresh session.
function buildHandoff({ projectDir, transcriptPath, sessionId, pendingPrompt, maxChars = 8000 }) {
  const p = paths(projectDir);
  const s = summarize(transcriptPath);
  let state = '';
  try {
    state = fs.readFileSync(p.state, 'utf8').trim();
  } catch {}

  const out = ['# MinCtx handoff', ''];
  out.push(`From session ${sessionId || 'unknown'} (context ~${Math.round(s.contextTokens / 1000)}K tokens, dropped).`);
  out.push('Code and files on disk are current; read them on demand. Do not re-explore the project.');
  out.push('');

  if (state) {
    out.push('## Task state (.minctx/state.md)', state, '');
  } else if (s.prompts.length) {
    out.push('## Task (no state.md was written; from user prompts)');
    out.push(`- First: ${clip(s.prompts[0], 400)}`);
    for (const pr of s.prompts.slice(1).slice(-4)) out.push(`- Later: ${clip(pr, 300)}`);
    out.push('');
  }

  if (s.modified.length) {
    out.push('## Modified this session');
    for (const f of s.modified.slice(-30)) out.push(`- ${rel(projectDir, f)}`);
    out.push('');
  }

  const lastTest = s.tests[s.tests.length - 1];
  if (lastTest) {
    out.push('## Last check', `- \`${clip(lastTest.command, 160)}\` -> ${lastTest.error ? 'FAILED' : 'ok'}`, '');
  }

  if (pendingPrompt) {
    out.push('## Pending user request (not yet answered)', pendingPrompt.trim(), '');
  }

  if (transcriptPath) {
    out.push('## Recover', `Previous transcript: ${transcriptPath}`, 'Grep it for a specific past detail only if needed.');
  }

  let text = out.join('\n').trim() + '\n';
  if (text.length > maxChars) text = text.slice(0, maxChars - 40) + '\n…(handoff truncated)\n';
  return text;
}

function writeHandoff(projectDir, opts) {
  const p = ensureDir(projectDir);
  const text = buildHandoff({ projectDir, ...opts });
  fs.writeFileSync(p.handoff, text);
  writeJson(p.handoffMeta, {
    pending: true,
    fromSession: opts.sessionId || null,
    transcriptPath: opts.transcriptPath || null,
    createdAt: Date.now(),
    reason: opts.reason || 'manual',
  });
  return { text, file: p.handoff };
}

// Returns the handoff text once (and marks it consumed), or null.
function takeHandoff(projectDir, sessionId, maxAgeHours) {
  const p = paths(projectDir);
  const meta = readJson(p.handoffMeta, null);
  if (!meta || !meta.pending || meta.fromSession === sessionId) return null;
  if (Date.now() - (meta.createdAt || 0) > maxAgeHours * 3600 * 1000) return null;
  let text;
  try {
    text = fs.readFileSync(p.handoff, 'utf8');
  } catch {
    return null;
  }
  writeJson(p.handoffMeta, { ...meta, pending: false, consumedBy: sessionId, consumedAt: Date.now() });
  return text;
}

module.exports = {
  paths, ensureDir, readJson, writeJson, log, sessionFlags, buildHandoff, writeHandoff, takeHandoff,
};
