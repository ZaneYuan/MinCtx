#!/usr/bin/env node
'use strict';
// MinCtx hook dispatcher. Usage: minctx.js <session-start|prompt-submit|pre-tool|checkpoint|limit>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { contextTokens } = require('./lib/transcript');
const { checkRead, checkBash, checkPowerShell } = require('./lib/guard');
const st = require('./lib/state');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const CHECKPOINT_CMD = `node "${path.join(PLUGIN_ROOT, 'scripts', 'minctx.js')}" checkpoint`;

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

const k = (n) => `${Math.round(n / 1000)}K`;
const approxTokens = (s) => Math.ceil(s.length / 3.5);

function remember(projectDir, input) {
  if (!input.session_id) return;
  st.ensureDir(projectDir);
  st.writeJson(st.paths(projectDir).last, {
    sessionId: input.session_id,
    transcriptPath: input.transcript_path || null,
    at: Date.now(),
  });
}

function sessionStart(input, cfg, projectDir) {
  remember(projectDir, input);
  const source = input.source || 'startup';
  if (source === 'resume' || source === 'fork') return; // Protocol is already in that history.

  const protocol = fs.readFileSync(path.join(PLUGIN_ROOT, 'rules', 'protocol.md'), 'utf8').trim();
  const handoff =
    source === 'startup' || source === 'clear'
      ? st.takeHandoff(projectDir, input.session_id, cfg.rollover.handoffMaxAgeHours)
      : null;

  if (cfg.mode === 'shadow') {
    st.log(projectDir, { event: 'session_start', session: input.session_id, source, action: 'shadow', handoff: !!handoff });
    return;
  }

  let ctx = protocol;
  if (handoff) {
    ctx +=
      '\n\n' + handoff.trim() +
      '\n\nContinue from this handoff. If a pending user request is listed and the next message just says to continue, answer the pending request; a new request takes priority.';
  }
  const out = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } };
  if (handoff) {
    out.systemMessage = `MinCtx: resumed from handoff (~${approxTokens(handoff)} tokens instead of the old context). Send "continue" to pick up the pending request.`;
    st.log(projectDir, { event: 'handoff_loaded', session: input.session_id, tokens: approxTokens(handoff) });
  }
  emit(out);
}

function promptSubmit(input, cfg, projectDir) {
  remember(projectDir, input);
  const r = cfg.rollover;
  if (!r.enabled) return;
  const prompt = String(input.prompt || '');
  // Never block slash commands: /clear and /minctx:checkpoint are the way out.
  if (prompt.trimStart().startsWith('/')) return;

  const tokens = contextTokens(input.transcript_path);
  const sid = input.session_id;

  if (tokens >= r.hardTokens) {
    if (r.overridePrefix && prompt.startsWith(r.overridePrefix)) {
      st.log(projectDir, { event: 'rollover', session: sid, tokens, action: 'override' });
      return;
    }
    if (cfg.mode === 'shadow') {
      st.log(projectDir, { event: 'rollover', session: sid, tokens, action: 'shadow' });
      return;
    }
    const { text } = st.writeHandoff(projectDir, {
      transcriptPath: input.transcript_path,
      sessionId: sid,
      pendingPrompt: prompt,
      maxChars: cfg.handoff.maxChars,
      reason: 'hard-limit',
    });
    st.log(projectDir, { event: 'rollover', session: sid, tokens, action: 'block', handoffTokens: approxTokens(text) });
    emit({
      decision: 'block',
      reason:
        `MinCtx: context is ${k(tokens)} tokens (limit ${k(r.hardTokens)}). This prompt was NOT sent, so it cost nothing.\n` +
        `Handoff saved to .minctx/handoff.md (~${approxTokens(text)} tokens, includes your prompt).\n` +
        `Run /clear, then send "continue" to resume in a fresh session. ` +
        `To send to this session anyway, prefix the message with "${r.overridePrefix}".`,
    });
    return;
  }

  if (tokens >= r.softTokens && !st.sessionFlags(projectDir, sid).softWarned) {
    st.sessionFlags(projectDir, sid, { softWarned: true });
    if (cfg.mode === 'shadow') {
      st.log(projectDir, { event: 'soft_limit', session: sid, tokens, action: 'shadow' });
      return;
    }
    st.log(projectDir, { event: 'soft_limit', session: sid, tokens, action: 'nudge' });
    emit({
      systemMessage: `MinCtx: context ${k(tokens)} tokens (soft limit ${k(r.softTokens)}). A fresh session is recommended at the next task boundary.`,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          `MinCtx: context is ${k(tokens)} tokens (hard limit ${k(r.hardTokens)}). Keep .minctx/state.md current. ` +
          `When the current task reaches a natural boundary, run \`${CHECKPOINT_CMD}\` and tell the user to /clear.`,
      },
    });
  }
}

function preTool(input, cfg, projectDir) {
  if (!cfg.readGuard.enabled) return;
  const cwd = input.cwd || projectDir;
  const hit =
    input.tool_name === 'Read' ? checkRead(input.tool_input, cwd, cfg)
      : input.tool_name === 'Bash' ? checkBash(input.tool_input, cwd, cfg)
        : input.tool_name === 'PowerShell' ? checkPowerShell(input.tool_input, cwd, cfg)
          : null;
  if (!hit) return;
  const action = cfg.mode === 'shadow' ? 'shadow' : 'deny';
  st.log(projectDir, {
    event: 'read_guard', session: input.session_id, agent: input.agent_id || null,
    tool: input.tool_name, file: hit.file, lines: hit.lines, action,
  });
  if (action === 'shadow') return;
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: hit.reason,
    },
  });
}

function findProjectDir(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.minctx', 'last.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// Manual rollover, run by Claude via /minctx:checkpoint or after a soft-limit nudge.
function checkpoint() {
  const projectDir = findProjectDir(process.cwd());
  if (!projectDir) {
    console.log('MinCtx: no active session found (.minctx/last.json missing). Is the plugin enabled?');
    process.exitCode = 1;
    return;
  }
  const cfg = loadConfig(projectDir);
  const last = st.readJson(st.paths(projectDir).last, {});
  const { text, file } = st.writeHandoff(projectDir, {
    transcriptPath: last.transcriptPath,
    sessionId: last.sessionId,
    maxChars: cfg.handoff.maxChars,
    reason: 'manual',
  });
  st.log(projectDir, { event: 'checkpoint', session: last.sessionId, handoffTokens: approxTokens(text) });
  console.log(`MinCtx: handoff saved to ${path.relative(process.cwd(), file) || file} (~${approxTokens(text)} tokens).`);
  console.log('Next: the user runs /clear; the fresh session loads this handoff automatically.');
}

function parseTokens(s) {
  const m = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(String(s || '').trim());
  if (!m) return null;
  const mult = { '': 1, k: 1e3, m: 1e6 }[m[2].toLowerCase()];
  return Math.round(Number(m[1]) * mult);
}

// Usage: minctx.js limit <hard> [soft]. Writes ~/.minctx/config.json; soft defaults to 80% of hard.
function limit(args) {
  const hard = parseTokens(args[0]);
  const soft = args[1] == null ? null : parseTokens(args[1]);
  if (!hard || hard < 50000 || (args[1] != null && (!soft || soft >= hard))) {
    console.log('Usage: /minctx:limit <hard> [soft]   e.g. /minctx:limit 450k  or  /minctx:limit 450k 350k');
    console.log('hard >= 50k; soft < hard (default: 80% of hard).');
    process.exitCode = 1;
    return;
  }
  const file = path.join(os.homedir(), '.minctx', 'config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const cur = st.readJson(file, {});
  cur.rollover = { ...(cur.rollover || {}), hardTokens: hard, softTokens: soft };
  st.writeJson(file, cur);
  const eff = loadConfig(findProjectDir(process.cwd()) || process.cwd()).rollover;
  console.log(`MinCtx: saved to ${file}. Effective here: soft ${k(eff.softTokens)} · hard ${k(eff.hardTokens)}.`);
  if (eff.hardTokens !== hard) console.log('Note: this project\'s .minctx/config.json overrides the global limit.');
}

function main() {
  const cmd = process.argv[2];
  if (cmd === 'checkpoint') return checkpoint();
  if (cmd === 'limit') return limit(process.argv.slice(3));
  const input = readInput();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const cfg = loadConfig(projectDir);
  if (cfg.mode === 'off') return;
  const handlers = { 'session-start': sessionStart, 'prompt-submit': promptSubmit, 'pre-tool': preTool };
  const h = handlers[cmd];
  if (!h) {
    process.stderr.write(`minctx: unknown command ${cmd}\n`);
    process.exitCode = 1;
    return;
  }
  h(input, cfg, projectDir);
}

try {
  main();
} catch (err) {
  // Fail open: a MinCtx bug must never block the user's work.
  process.stderr.write(`minctx: ${err && err.stack ? err.stack : err}\n`);
  process.exitCode = 0;
}
