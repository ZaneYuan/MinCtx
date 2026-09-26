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

const stopIn = (d, transcript, sid = 'S1', active = false) => ({
  session_id: sid, transcript_path: transcript, cwd: d, hook_event_name: 'Stop', stop_hook_active: active,
});

test('stop: below the heads-up threshold is silent', () => {
  const { d, transcript } = project(200000);
  assert.strictEqual(runHook('stop', stopIn(d, transcript), { projectDir: d }).stdout, '');
});

test('stop: heads-up once at 80% of the limit', () => {
  const { d, transcript } = project(380000);
  const r1 = runHook('stop', stopIn(d, transcript), { projectDir: d });
  assert.match(r1.json.systemMessage, /380K tokens \(hand-off at 450K\)/);
  assert.strictEqual(r1.json.decision, undefined, 'never blocks at the heads-up');
  assert.strictEqual(runHook('stop', stopIn(d, transcript), { projectDir: d }).stdout, '');
});

test('stop: at the limit, asks for one state refresh, then writes the handoff after the turn', () => {
  const { d, transcript } = project(460000);
  const r1 = runHook('stop', stopIn(d, transcript), { projectDir: d });
  assert.strictEqual(r1.json.decision, 'block');
  assert.match(r1.json.reason, /Rewrite \.minctx\/state\.md/);
  assert.ok(!fs.existsSync(path.join(d, '.minctx', 'handoff.md')));

  // Claude updates state.md, stops again (stop_hook_active) -> handoff, turn ends normally.
  fs.writeFileSync(path.join(d, '.minctx', 'state.md'), 'goal: fix delete\nnext: audit log\n');
  const r2 = runHook('stop', stopIn(d, transcript, 'S1', true), { projectDir: d });
  assert.strictEqual(r2.json.decision, undefined);
  assert.match(r2.json.systemMessage, /this turn finished at 460K/);
  assert.match(r2.json.systemMessage, /\/clear/);
  const h = fs.readFileSync(path.join(d, '.minctx', 'handoff.md'), 'utf8');
  assert.match(h, /goal: fix delete/);
  assert.match(h, /src[\\/]Svc\.cs/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, '.minctx', 'handoff.json'), 'utf8')).reason, 'turn-end');

  // Later turn ends (user chose to continue with ++): refresh the handoff, never ask again.
  const r3 = runHook('stop', stopIn(d, transcript), { projectDir: d });
  assert.strictEqual(r3.json.decision, undefined);
  assert.match(r3.json.systemMessage, /Handoff saved/);
});

test('stop: refreshState false writes the handoff directly', () => {
  const { d, transcript } = project(460000);
  writeConfig(d, { rollover: { refreshState: false } });
  const r = runHook('stop', stopIn(d, transcript), { projectDir: d });
  assert.strictEqual(r.json.decision, undefined);
  assert.ok(fs.existsSync(path.join(d, '.minctx', 'handoff.md')));
});

test('stop: shadow mode only logs', () => {
  const { d, transcript } = project(460000);
  writeConfig(d, { mode: 'shadow' });
  assert.strictEqual(runHook('stop', stopIn(d, transcript), { projectDir: d }).stdout, '');
  assert.strictEqual(runHook('stop', stopIn(d, transcript), { projectDir: d }).stdout, '');
  assert.deepStrictEqual(readLog(d).map((e) => e.action), ['shadow']);
});

test('prompt-submit: never acts below the limit (no mid-task interference)', () => {
  const { d, transcript } = project(440000);
  assert.strictEqual(runHook('prompt-submit', prompt(d, transcript, 'next'), { projectDir: d }).stdout, '');
});

test('prompt-submit: over the limit, the next prompt is held and saved into the handoff', () => {
  const { d, transcript } = project(460000);
  fs.mkdirSync(path.join(d, '.minctx'), { recursive: true });
  fs.writeFileSync(path.join(d, '.minctx', 'state.md'), 'goal: fix delete\nnext: mixed-member test\n');
  const r = runHook('prompt-submit', prompt(d, transcript, 'now add the audit log'), { projectDir: d });
  assert.strictEqual(r.json.decision, 'block');
  assert.match(r.json.reason, /460K/);
  assert.match(r.json.reason, /NOT sent/);
  const h = fs.readFileSync(path.join(d, '.minctx', 'handoff.md'), 'utf8');
  assert.match(h, /goal: fix delete/);
  assert.match(h, /now add the audit log/);
  assert.ok(h.includes(transcript));
  assert.ok(!h.includes('Fix DeleteMember in NeedAnalysisService'), 'state.md replaces prompt history');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, '.minctx', 'handoff.json'), 'utf8')).pending, true);
});

test('prompt-submit: slash commands, override prefix and shadow mode are not blocked', () => {
  const { d, transcript } = project(460000);
  assert.strictEqual(runHook('prompt-submit', prompt(d, transcript, '/clear'), { projectDir: d }).stdout, '');
  assert.strictEqual(runHook('prompt-submit', prompt(d, transcript, '++ one more thing'), { projectDir: d }).stdout, '');
  writeConfig(d, { mode: 'shadow' });
  assert.strictEqual(runHook('prompt-submit', prompt(d, transcript, 'hi'), { projectDir: d }).stdout, '');
  assert.deepStrictEqual(readLog(d).map((e) => e.action), ['override', 'shadow']);
});

test('limits are configurable (e.g. 150K on a 200K window)', () => {
  const { d, transcript } = project(160000);
  assert.strictEqual(runHook('prompt-submit', prompt(d, transcript, 'go'), { projectDir: d }).stdout, '');
  writeConfig(d, { rollover: { hardTokens: 150000 } });
  assert.strictEqual(runHook('prompt-submit', prompt(d, transcript, 'go'), { projectDir: d }).json.decision, 'block');
});

test('limit CLI sets global thresholds; soft defaults to 80% of hard', () => {
  const { d, transcript } = project(300000);
  const env = { ...process.env, HOME: d, USERPROFILE: d };
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'minctx.js'), 'limit', ...args], { cwd: d, encoding: 'utf8', env });

  assert.strictEqual(run('abc').status, 1);
  assert.strictEqual(run('300k', '400k').status, 1);
  const r = run('250k');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /hand-off at 250K tokens, heads-up at 200K/);
  const out = runHook('prompt-submit', prompt(d, transcript, 'go'), { projectDir: d });
  assert.strictEqual(out.json.decision, 'block');
});

test('session-start: injects protocol, then the pending handoff exactly once', () => {
  const { d, transcript } = project(460000);
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
  const { d, transcript } = project(460000);
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
  const { d, transcript } = project(460000);
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

test('pre-tool: PowerShell Get-Content of a large file is denied; bounded reads pass', () => {
  const d = tmpDir();
  bigFile(d, 'big.js', 1000);
  const run = (command) => runHook('pre-tool', { cwd: d, tool_name: 'PowerShell', tool_input: { command } }, { projectDir: d });
  assert.strictEqual(run('Get-Content big.js').json.hookSpecificOutput.permissionDecision, 'deny');
  assert.strictEqual(run('gc -Path "big.js"').json.hookSpecificOutput.permissionDecision, 'deny');
  assert.strictEqual(run('type big.js').json.hookSpecificOutput.permissionDecision, 'deny');
  assert.strictEqual(run('Get-Content big.js -TotalCount 80').stdout, '');
  assert.strictEqual(run('Get-Content big.js | Select-String helper').stdout, '');
});

test('limit CLI shows, sets soft explicitly, and turns hand-off off/on', () => {
  const d = tmpDir();
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'minctx.js'), 'limit', ...args], { cwd: d, encoding: 'utf8', env: { ...process.env, HOME: d, USERPROFILE: d } });
  assert.match(run().stdout, /hand-off at 450K tokens, heads-up at 360K/);
  assert.match(run('1m', '700k').stdout, /hand-off at 1M tokens, heads-up at 700K/);
  const cfg = JSON.parse(fs.readFileSync(path.join(d, '.minctx', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.rollover.hardTokens, 1000000);
  assert.match(run('off').stdout, /automatic hand-off is off/);
  assert.match(run('on').stdout, /hand-off at 1M/);
  assert.match(run('200k').stdout, /heads-up at 160K/, 'new hard without soft resets heads-up to 80%');
});

test('stats: reads denied by the guard are not counted as reads', () => {
  const { d, transcript } = project(90000, [
    T.assistant(T.usage(91000), [T.toolUse('r1', 'Read', { file_path: '/p/big.js' })]),
    T.toolResult('r1', 'MinCtx: big.js has 1020 lines', true),
    T.assistant(T.usage(92000), [T.toolUse('r2', 'Read', { file_path: '/p/big.js', offset: 100, limit: 3 })]),
    T.toolResult('r2', 'a\nb\nc'),
  ]);
  runHook('prompt-submit', prompt(d, transcript, 'x'), { projectDir: d });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'stats.js')], { cwd: d, encoding: 'utf8', env: { ...process.env, HOME: d } });
  assert.match(r.stdout, /Reads\s+1 of 1 files, ~3 lines \(ranged 1 · full 0\) · 1 denied\/failed not counted/);
});
