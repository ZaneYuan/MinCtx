'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { checkRead, checkBash, checkPowerShell, outline } = require('../scripts/lib/guard');
const { DEFAULTS } = require('../scripts/lib/config');
const { tmpDir, bigFile } = require('./helpers');

const cfg = DEFAULTS;

test('small files and ranged reads pass', () => {
  const d = tmpDir();
  bigFile(d, 'small.js', 100);
  bigFile(d, 'big.js', 1000);
  assert.strictEqual(checkRead({ file_path: 'small.js' }, d, cfg), null);
  assert.strictEqual(checkRead({ file_path: 'big.js', offset: 200, limit: 80 }, d, cfg), null);
  assert.strictEqual(checkRead({ file_path: 'big.js', limit: 2000 }, d, cfg), null);
});

test('unbounded read of a large file is narrowed with an outline', () => {
  const d = tmpDir();
  const f = bigFile(d, 'big.js', 1000);
  const hit = checkRead({ file_path: f }, '/', cfg);
  assert.ok(hit);
  assert.strictEqual(hit.lines, 1020);
  assert.match(hit.reason, /1020 lines/);
  assert.match(hit.reason, /L1: function helper1\(a, b\) \{/);
  assert.match(hit.reason, /offset: 1, limit: 1020/);
});

test('binary, image, missing and directory paths pass through', () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, 'blob.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.alloc(50000, 10)]));
  fs.writeFileSync(path.join(d, 'pic.png'), 'x\n'.repeat(5000));
  assert.strictEqual(checkRead({ file_path: 'blob.bin' }, d, cfg), null);
  assert.strictEqual(checkRead({ file_path: 'pic.png' }, d, cfg), null);
  assert.strictEqual(checkRead({ file_path: 'missing.js' }, d, cfg), null);
  assert.strictEqual(checkRead({ file_path: '.' }, d, cfg), null);
});

test('maxLines is configurable', () => {
  const d = tmpDir();
  bigFile(d, 'mid.js', 250);
  assert.strictEqual(checkRead({ file_path: 'mid.js' }, d, cfg), null);
  assert.ok(checkRead({ file_path: 'mid.js' }, d, { ...cfg, readGuard: { ...cfg.readGuard, maxLines: 100 } }));
});

test('bash cat of a large file is guarded; pipelines are not', () => {
  const d = tmpDir();
  bigFile(d, 'big.js', 1000);
  const hit = checkBash({ command: 'cat big.js' }, d, cfg);
  assert.ok(hit);
  assert.match(hit.reason, /use Read with offset/);
  assert.ok(checkBash({ command: 'cat "big.js"' }, d, cfg));
  assert.strictEqual(checkBash({ command: 'cat big.js | grep helper' }, d, cfg), null);
  assert.strictEqual(checkBash({ command: 'cat a.js b.js' }, d, cfg), null);
  assert.strictEqual(checkBash({ command: 'ls -la' }, d, cfg), null);
});

test('PowerShell whole-file reads are narrowed; bounded or piped reads pass', () => {
  const d = tmpDir();
  bigFile(d, 'big.js', 1000);
  for (const c of ['Get-Content big.js', 'gc "big.js"', 'type big.js', 'Get-Content -Path big.js', "get-content -LiteralPath 'big.js'"]) {
    assert.ok(checkPowerShell({ command: c }, d, cfg), c);
  }
  assert.match(checkPowerShell({ command: 'Get-Content big.js' }, d, cfg).reason, /use Read with offset/);
  for (const c of ['Get-Content big.js -TotalCount 50', 'Get-Content big.js | Select-Object -First 20', 'Get-Content small.js', 'Get-ChildItem']) {
    assert.strictEqual(checkPowerShell({ command: c }, d, cfg), null, c);
  }
});

test('outline covers common languages and markdown headings', () => {
  const src = [
    'using System;',
    'namespace Crm.Services {',
    '  public class NeedAnalysisService {',
    '    public async Task UpdateMembers(Guid id, List<Member> members)',
    '    {',
    '      return;',
    '    }',
    '  }',
    '}',
    'def parse(x):',
    'export const load = async (p) => {',
    'fn main() {',
  ].join('\n');
  const o = outline(src, 40, '.cs').join('\n');
  for (const s of ['namespace Crm.Services', 'public class NeedAnalysisService', 'UpdateMembers', 'def parse', 'export const load', 'fn main']) {
    assert.ok(o.includes(s), `outline missing ${s}:\n${o}`);
  }
  assert.ok(!o.includes('return'));
  assert.deepStrictEqual(outline('# Title\ntext\n## Install\n', 40, '.md'), ['L1: # Title', 'L3: ## Install']);
});

test('markdown outline skips fenced code blocks', () => {
  const md = '# A\n```sh\n# not a heading\n```\n## B\n';
  assert.deepStrictEqual(outline(md, 40, '.md'), ['L1: # A', 'L5: ## B']);
});

test('bash readers: span-aware for cat -n, nl, head, tail, sed', () => {
  const d = tmpDir();
  bigFile(d, 'big.js', 1000); // 1020 lines
  const deny = (command) => assert.ok(checkBash({ command }, d, cfg), `should deny: ${command}`);
  const allow = (command) => assert.strictEqual(checkBash({ command }, d, cfg), null, `should allow: ${command}`);
  deny('cat -n big.js');
  deny('nl big.js');
  deny('head -n 5000 big.js');
  deny('head -2000 big.js');
  deny('tail -n +1 big.js');
  deny("sed -n '1,2000p' big.js");
  deny("sed -n '100,$p' big.js");
  allow('head -n 80 big.js');
  allow('head big.js');
  allow('tail -n 50 big.js');
  allow("sed -n '120,200p' big.js");
  allow("sed 's/a/b/' big.js");
  allow('cat -n big.js | sed -n 100,200p');
  allow('grep -n helper big.js');
});

test('outline truncation says how many entries were left out', () => {
  const d = tmpDir();
  const f = bigFile(d, 'big.js', 3000); // 60 functions
  const hit = checkRead({ file_path: f }, d, { ...cfg, readGuard: { ...cfg.readGuard, outlineEntries: 10 } });
  assert.match(hit.reason, /\.\.\.50 more entries after L\d+ not shown/);
});
