'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { aggregate, table, loadTasks } = require('../bench/run');

const r = (arm, pass, inputTokens, outputTokens = 100) => ({
  arm, pass, inputTokens, outputTokens, costUsd: 0, turns: 5, toolCalls: 5, filesRead: 2, linesRead: 100, seconds: 30,
});

test('safe saving requires fewer tokens and held quality', () => {
  const ok = aggregate([r('baseline', true, 10000), r('baseline', true, 10000), r('minctx', true, 4000), r('minctx', true, 5000)]);
  assert.strictEqual(ok.summary.minctx.inputTokens, 4500);
  assert.ok(Math.abs(ok.verdict.delta.inputTokens + 0.55) < 1e-9);
  assert.strictEqual(ok.verdict.safeSaving, true);

  const worse = aggregate([r('baseline', true, 10000), r('baseline', true, 10000), r('minctx', true, 3000), r('minctx', false, 3000)]);
  assert.strictEqual(worse.verdict.qualityOk, false);
  assert.strictEqual(worse.verdict.safeSaving, false);
  const tolerant = aggregate([r('baseline', true, 1), r('baseline', true, 1), r('minctx', false, 1), r('minctx', true, 1)], 0.5);
  assert.strictEqual(tolerant.verdict.qualityOk, true);

  assert.match(table(ok, 0), /Safe saving: PASS/);
  assert.match(table(ok, 0), /smoke test/);
});

test('bundled tasks are well-formed', () => {
  const tasks = loadTasks(path.join(__dirname, '..', 'bench', 'tasks'));
  assert.ok(tasks.length >= 1);
  for (const t of tasks) {
    assert.ok(t.name && t.prompt && Array.isArray(t.check), t.dir);
  }
});
