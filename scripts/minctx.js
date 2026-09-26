#!/usr/bin/env node
'use strict';
// MinCtx hook dispatcher.
// Hooks:  minctx.js <session-start|prompt-submit|pre-tool|stop>   (JSON on stdin)
// CLI:    minctx.js checkpoint | minctx.js limit [450k|1m|off|on]
const fs = require('fs');
const path = require('path');
const { loadConfig, readJson, parseTokens } = require('./lib/config');
const { contextTokens } = require('./lib/transcript');
const { checkRead, checkBash, checkPowerShell } = require('./lib/guard');
const st = require('./lib/state');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');

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
    out.systemMessage = `MinCtx: resumed from handoff (~${approxTokens(handoff)} tokens instead of the old context). Send "continue" to pick up where you left off.`;
    st.log(projectDir, { event: 'handoff_loaded', session: input.session_id, tokens: approxTokens(handoff) });
  }
  emit(out);
}

// Turn end. The rollover decision lives here so a running turn is never cut off:
// its input is already paid for, so it finishes first and the handoff is taken at a clean point.
function stop(input, cfg, projectDir) {
  const r = cfg.rollover;
  if (!r.enabled || !input.transcript_path) return;
  const sid = input.session_id;
  const tokens = contextTokens(input.transcript_path);
  const flags = st.sessionFlags(projectDir, sid);

  if (tokens >= r.hardTokens) {
    if (cfg.mode === 'shadow') {
      if (!flags.hardLogged) {
        st.sessionFlags(projectDir, sid, { hardLogged: true });
        st.log(projectDir, { event: 'rollover', session: sid, tokens, action: 'shadow' });
      }
      return;
    }
    // One short extra step so the handoff carries Claude's own decisions and next step.
    if (r.refreshState && !input.stop_hook_active && !flags.stateRequested) {
      st.sessionFlags(projectDir, sid, { stateRequested: true });
      st.log(projectDir, { event: 'state_refresh', session: sid, tokens });
      emit({
        decision: 'block',
        reason:
          `MinCtx: context is ${k(tokens)} tokens (limit ${k(r.hardTokens)}); this session hands off to a fresh one now. ` +
          'Rewrite .minctx/state.md (<=25 lines: goal / done / decisions+why / blockers / next; no code, no file contents). ' +
          'Do nothing else, then stop with a one-line reply.',
      });
      return;
    }
    const { text } = st.writeHandoff(projectDir, {
      transcriptPath: input.transcript_path,
      sessionId: sid,
      maxChars: cfg.handoff.maxChars,
      reason: 'turn-end',
    });
    st.sessionFlags(projectDir, sid, { handoffAt: Date.now() });
    st.log(projectDir, { event: 'rollover', session: sid, tokens, action: 'handoff', handoffTokens: approxTokens(text) });
    emit({
      systemMessage:
        `MinCtx: this turn finished at ${k(tokens)} tokens (limit ${k(r.hardTokens)}). ` +
        `Handoff saved (~${approxTokens(text)} tokens). Run /clear, then send "continue" to keep going in a fresh session.`,
    });
    return;
  }

  if (tokens >= r.softTokens && !flags.softWarned) {
    st.sessionFlags(projectDir, sid, { softWarned: true });
    st.log(projectDir, { event: 'soft_limit', session: sid, tokens, action: cfg.mode === 'shadow' ? 'shadow' : 'notice' });
    if (cfg.mode === 'shadow') return;
    emit({
      systemMessage:
        `MinCtx: context is ${k(tokens)} tokens (hand-off at ${k(r.hardTokens)}). ` +
        'If the current task is done, /minctx:checkpoint then /clear starts the next one cheaply.',
    });
  }
}

// Between turns only: stops the next, most expensive prompt from being sent to an oversized session.
function promptSubmit(input, cfg, projectDir) {
  remember(projectDir, input);
  const r = cfg.rollover;
  if (!r.enabled) return;
  const prompt = String(input.prompt || '');
  // Never block slash commands: /clear and /minctx:* are the way out.
  if (prompt.trimStart().startsWith('/')) return;

  const tokens = contextTokens(input.transcript_path);
  if (tokens < r.hardTokens) return;
  const sid = input.session_id;

  if (r.overridePrefix && prompt.startsWith(r.overridePrefix)) {
    st.log(projectDir, { event: 'prompt_guard', session: sid, tokens, action: 'override' });
    return;
  }
  if (cfg.mode === 'shadow') {
    st.log(projectDir, { event: 'prompt_guard', session: sid, tokens, action: 'shadow' });
    return;
  }
  const { text } = st.writeHandoff(projectDir, {
    transcriptPath: input.transcript_path,
    sessionId: sid,
    pendingPrompt: prompt,
    maxChars: cfg.handoff.maxChars,
    reason: 'prompt-guard',
  });
  st.log(projectDir, { event: 'prompt_guard', session: sid, tokens, action: 'block', handoffTokens: approxTokens(text) });
  emit({
    decision: 'block',
    reason:
      `MinCtx: this session is at ${k(tokens)} tokens (limit ${k(r.hardTokens)}), so this message was NOT sent and cost nothing.\n` +
      `It is saved in the handoff (~${approxTokens(text)} tokens). Run /clear, then send "continue".\n` +
      `To send it to this session anyway, start the message with "${r.overridePrefix}".`,
  });
}

function preTool(input, cfg, projectDir) {
  if (!cfg.readGuard.enabled) return;
  const cwd = input.cwd || projectDir;
  const check = { Read: checkRead, Bash: checkBash, PowerShell: checkPowerShell }[input.tool_name];
  const hit = check ? check(input.tool_input, cwd, cfg) : null;
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

function findProjectDir(start, marker) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.minctx', marker))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// Manual rollover, run by Claude via /minctx:checkpoint.
function checkpoint() {
  const projectDir = findProjectDir(process.cwd(), 'last.json');
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
  console.log('Next: run /clear; the fresh session loads this handoff automatically.');
}

// Show or set this project's hand-off limit: /minctx:limit 450k | 1m | off | on
function limit(arg) {
  const projectDir = findProjectDir(process.cwd(), '') || process.cwd();
  const p = st.ensureDir(projectDir);
  const file = path.join(p.dir, 'config.json');
  const show = () => {
    const r = loadConfig(projectDir).rollover;
    return r.enabled
      ? `hand-off at ${k(r.hardTokens)} tokens, heads-up at ${k(r.softTokens)}`
      : 'automatic hand-off is off';
  };
  const a = String(arg || '').trim().toLowerCase();
  if (!a) {
    console.log(`MinCtx: ${show()} (this project). Change with /minctx:limit 450k, 1m, off or on.`);
    return;
  }
  const cur = readJson(file) || {};
  const rollover = { ...(cur.rollover || {}) };
  if (a === 'off' || a === 'on') {
    rollover.enabled = a === 'on';
  } else {
    const n = parseTokens(a);
    if (!n || n < 20000) {
      console.log(`MinCtx: "${arg}" is not a valid limit. Use e.g. 150k, 450k or 1m (minimum 20k).`);
      process.exitCode = 1;
      return;
    }
    rollover.enabled = true;
    rollover.hardTokens = n;
    delete rollover.softTokens; // Heads-up follows the new limit via softRatio.
  }
  st.writeJson(file, { ...cur, rollover });
  console.log(`MinCtx: ${show()} (saved to .minctx/config.json).`);
}

function main() {
  const cmd = process.argv[2];
  if (cmd === 'checkpoint') return checkpoint();
  if (cmd === 'limit') return limit(process.argv.slice(3).join(' '));
  const input = readInput();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const cfg = loadConfig(projectDir);
  if (cfg.mode === 'off') return;
  const handlers = { 'session-start': sessionStart, 'prompt-submit': promptSubmit, 'pre-tool': preTool, stop };
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
