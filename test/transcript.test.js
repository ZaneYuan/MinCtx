'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { contextTokens, summarize } = require('../scripts/lib/transcript');
const { tmpDir, T, writeTranscript } = require('./helpers');

test('contextTokens: last main-chain request, ignoring subagent entries', () => {
  const d = tmpDir();
  const f = writeTranscript(d, [
    T.user('fix the bug'),
    T.assistant(T.usage(50000)),
    T.assistant(T.usage(900000), [], { isSidechain: true }),
  ]);
  assert.strictEqual(contextTokens(f), 50000);
});

test('contextTokens: 0 right after a compaction, 0 for missing file', () => {
  const d = tmpDir();
  const f = writeTranscript(d, [
    T.assistant(T.usage(180000)),
    { type: 'system', subtype: 'compact_boundary' },
    T.user('continue'),
  ]);
  assert.strictEqual(contextTokens(f), 0);
  assert.strictEqual(contextTokens(path.join(d, 'nope.jsonl')), 0);
});

test('contextTokens: finds usage beyond the first tail window', () => {
  const d = tmpDir();
  const filler = Array.from({ length: 600 }, (_, i) => T.user('<system-reminder>' + 'x'.repeat(1000) + i + '</system-reminder>'));
  const f = writeTranscript(d, [T.assistant(T.usage(42000)), ...filler]);
  assert.ok(fs.statSync(f).size > 256 * 1024);
  assert.strictEqual(contextTokens(f), 42000);
});

test('summarize: prompts, edits, reads, tests, deduped usage', () => {
  const d = tmpDir();
  const f = writeTranscript(d, [
    T.user('Fix DeleteMember so existing members are removed'),
    T.user('<command-name>/clear</command-name>'),
    T.user('reminder', { isMeta: true }),
    T.assistant(T.usage(20000), [T.toolUse('t1', 'Read', { file_path: '/p/a.cs', offset: 10, limit: 3 })], { id: 'm1' }),
    T.assistant(T.usage(20000), [], { id: 'm1' }), // same API response split across entries
    T.toolResult('t1', 'l10\nl11\nl12'),
    T.assistant(T.usage(21000), [T.toolUse('t2', 'Edit', { file_path: '/p/a.cs' }), T.toolUse('t3', 'Bash', { command: 'dotnet test' })], { id: 'm2' }),
    T.toolResult('t2', 'ok'),
    T.toolResult('t3', '1 failed', true),
    T.user('also handle Guid.Empty'),
  ]);
  const s = summarize(f);
  assert.deepStrictEqual(s.prompts, ['Fix DeleteMember so existing members are removed', 'also handle Guid.Empty']);
  assert.deepStrictEqual(s.modified, ['/p/a.cs']);
  assert.strictEqual(s.reads.length, 1);
  assert.strictEqual(s.reads[0].lines, 3);
  assert.strictEqual(s.reads[0].ranged, true);
  assert.strictEqual(s.tests.length, 1);
  assert.strictEqual(s.tests[0].error, true);
  assert.strictEqual(s.requests, 2);
  assert.strictEqual(s.toolCalls, 3);
  assert.strictEqual(s.contextTokens, 21000);
});
