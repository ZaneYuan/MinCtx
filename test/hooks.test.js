'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, tmpDir, T, writeTranscript, bigFile, runHook, writeConfig, readLog } = require('./helpers');

function project(ctxTokens, extra = []) {
  const d = tmpDir();
  const transcript = writeTranscript(d, [
    T.user('Fix DeleteMember in NeedAnalysisService'),
    T.assistant(T.usage(ctxTokens), [T.toolUse('t1', 'Edit', { file_path: path.join(d, 'src', 'Svc.cs') })]),
    T.toolResult('t1', 'ok'),
    ...extra,
  ]);
  return { d, transcript };
}

const prompt = (d, transcript, text, sid = 'S1') => ({
  session_id: sid, transcript_path: transcript, cwd: d, hook_event_name: 'UserPromptSubmit', prompt: text,
});

test('pre-tool: large unbounded Read is denied with guidance', () => {
  const d = tmpDir();
  const f = bigFile(d, 'big.js', 1000);
  const r = runHook('pre-tool', { session_id: 'S1', cwd: d, tool_name: 'Read', tool_input: { file_path: f } }, { projectDir: d });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /Outline:/);
  assert.strictEqual(readLog(d)[0].action, 'deny');
});

test('pre-tool: shadow mode allows but logs', () => {
  const d = tmpDir();
  const f = bigFile(d, 'big.js', 1000);
  writeConfig(d, { mode: 'shadow' });
  const r = runHook('pre-tool', { session_id: 'S1', cwd: d, tool_name: 'Read', tool_input: { file_path: f } }, { projectDir: d });
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(readLog(d)[0].action, 'shadow');
});

test('pre-tool: other tools and small reads produce no output', () => {
  const d = tmpDir();
  bigFile(d, 'small.js', 20);
  assert.strictEqual(runHook('pre-tool', { cwd: d, tool_name: 'Read', tool_input: { file_path: 'small.js' } }, { projectDir: d }).stdout, '');
  assert.strictEqual(runHook('pre-tool', { cwd: d, tool_name: 'Grep', tool_input: { pattern: 'x' } }, { projectDir: d }).stdout, '');
});

test('prompt-submit: below soft limit is silent', () => {
  const { d, transcript } = project(40000);
  const r = runHook('prompt-submit', prompt(d, transcript, 'next step'), { projectDir: d });
  assert.strictEqual(r.stdout, '');
  const last = JSON.parse(fs.readFileSync(path.join(d, '.minctx', 'last.json'), 'utf8'));
  assert.strictEqual(last.transcriptPath, transcript);
});

test('prompt-submit: soft limit nudges once per session', () => {
  const { d, transcript } = project(400000);
  const r1 = runHook('prompt-submit', prompt(d, transcript, 'next'), { projectDir: d });
  assert.match(r1.json.systemMessage, /soft limit/);
  assert.match(r1.json.hookSpecificOutput.additionalContext, /minctx\.js" checkpoint/);
  const r2 = runHook('prompt-submit', prompt(d, transcript, 'next again'), { projectDir: d });
  assert.strictEqual(r2.stdout, '');
});

test('prompt-submit: hard limit blocks the prompt and saves a handoff with it', () => {
  const { d, transcript } = project(480000);
  fs.mkdirSync(path.join(d, '.minctx'), { recursive: true });
  fs.writeFileSync(path.join(d, '.minctx', 'state.md'), 'goal: fix delete\nnext: mixed-member test\n');
  const r = runHook('prompt-submit', prompt(d, transcript, 'now add the audit log'), { projectDir: d });
  assert.strictEqual(r.json.decision, 'block');
  assert.match(r.json.reason, /480K/);
  const h = fs.readFileSync(path.join(d, '.minctx', 'handoff.md'), 'utf8');
  assert.match(h, /goal: fix delete/);
  assert.match(h, /now add the audit log/);
  assert.match(h, /src[\\/]Svc\.cs/);
  assert.ok(h.includes(transcript));
  assert.ok(!h.includes('Fix DeleteMember in NeedAnalysisService'), 'state.md replaces prompt history');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, '.minctx', 'handoff.json'), 'utf8')).pending, true);
});

test('prompt-submit: slash commands, override prefix and shadow mode are not blocked', () => {
  const { d, transcript } = project(480000);
  assert.strictEqual(runHook('prompt-submit', prompt(d, transcript, '/clear'), { projectDir: d }).stdout, '');
  assert.strictEqual(runHook('prompt-submit', prompt(d, transcript, '++ one more thing'), { projectDir: d }).stdout, '');
  writeConfig(d, { mode: 'shadow' });
  assert.strictEqual(runHook('prompt-submit', prompt(d, transcript, 'hi'), { projectDir: d }).stdout, '');
  assert.deepStrictEqual(readLog(d).map((e) => e.action), ['override', 'shadow']);
});

test('prompt-submit: limits are configurable (e.g. 400K on a 1M window)', () => {
  const { d, transcript } = project(300000);
  writeConfig(d, { rollover: { softTokens: 350000, hardTokens: 400000 } });
  assert.strictEqual(runHook('prompt-submit', prompt(d, transcript, 'go'), { projectDir: d }).stdout, '');
});

test('limit CLI sets global thresholds; soft defaults to 80% of hard', () => {
  const { d, transcript } = project(300000);
  const env = { ...process.env, HOME: d, USERPROFILE: d };
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'minctx.js'), 'limit', ...args], { cwd: d, encoding: 'utf8', env });

  assert.strictEqual(run('abc').status, 1);
  assert.strictEqual(run('300k', '400k').status, 1);
  const r = run('250k');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /soft 200K · hard 250K/);
  const out = runHook('prompt-submit', prompt(d, transcript, 'go'), { projectDir: d });
  assert.strictEqual(out.json.decision, 'block');
});

test('session-start: injects protocol, then the pending handoff exactly once', () => {
  const { d, transcript } = project(480000);
  runHook('prompt-submit', prompt(d, transcript, 'now add the audit log', 'OLD'), { projectDir: d });

  const s1 = runHook('session-start', { session_id: 'NEW', source: 'clear', cwd: d }, { projectDir: d });
  const ctx = s1.json.hookSpecificOutput.additionalContext;
  assert.match(ctx, /MinCtx protocol/);
  assert.match(ctx, /# MinCtx handoff/);
  assert.match(ctx, /now add the audit log/);
  assert.match(s1.json.systemMessage, /resumed from handoff/);

  const s2 = runHook('session-start', { session_id: 'NEWER', source: 'startup', cwd: d }, { projectDir: d });
  assert.ok(!s2.json.hookSpecificOutput.additionalContext.includes('MinCtx handoff'));
  assert.strictEqual(s2.json.systemMessage, undefined);
});

test('session-start: resume is silent; handoff is not re-injected into its own session', () => {
  const { d, transcript } = project(480000);
  runHook('prompt-submit', prompt(d, transcript, 'x', 'S1'), { projectDir: d });
  assert.strictEqual(runHook('session-start', { session_id: 'S1', source: 'resume', cwd: d }, { projectDir: d }).stdout, '');
  const r = runHook('session-start', { session_id: 'S1', source: 'compact', cwd: d }, { projectDir: d });
  assert.ok(!r.json.hookSpecificOutput.additionalContext.includes('MinCtx handoff'));
});

test('session-start: .minctx is self-gitignored', () => {
  const d = tmpDir();
  runHook('session-start', { session_id: 'S', source: 'startup', cwd: d }, { projectDir: d });
  assert.strictEqual(fs.readFileSync(path.join(d, '.minctx', '.gitignore'), 'utf8'), '*\n');
});

test('mode off disables every hook', () => {
  const { d, transcript } = project(480000);
  const env = { MINCTX_MODE: 'off' };
  assert.strictEqual(runHook('prompt-submit', prompt(d, transcript, 'x'), { projectDir: d, env }).stdout, '');
  assert.strictEqual(runHook('session-start', { session_id: 'S', source: 'startup', cwd: d }, { projectDir: d, env }).stdout, '');
});

test('hooks fail open on garbage input', () => {
  const d = tmpDir();
  for (const cmd of ['session-start', 'prompt-submit', 'pre-tool']) {
    const r = runHook(cmd, 'not json', { projectDir: d });
    assert.strictEqual(r.code, 0, cmd + ': ' + r.stderr);
  }
});

test('checkpoint CLI writes a handoff for the last active session', () => {
  const { d, transcript } = project(90000);
  runHook('prompt-submit', prompt(d, transcript, 'x'), { projectDir: d });
  const sub = path.join(d, 'src');
  fs.mkdirSync(sub, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'minctx.js'), 'checkpoint'], { cwd: sub, encoding: 'utf8', env: { ...process.env, HOME: d } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /handoff saved/);
  const meta = JSON.parse(fs.readFileSync(path.join(d, '.minctx', 'handoff.json'), 'utf8'));
  assert.strictEqual(meta.fromSession, 'S1');
  assert.strictEqual(meta.reason, 'manual');
});

test('stats CLI reports the last session', () => {
  const { d, transcript } = project(90000);
  runHook('prompt-submit', prompt(d, transcript, 'x'), { projectDir: d });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stats.js')], { cwd: d, encoding: 'utf8', env: { ...process.env, HOME: d } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Context now\s+90K/);
  assert.match(r.stdout, /Tool calls\s+1 \(Edit 1\)/);
});
