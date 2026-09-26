'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minctx-test-'));
}

// Minimal Claude Code transcript entries.
const T = {
  user: (text, extra = {}) => ({ type: 'user', message: { role: 'user', content: text }, ...extra }),
  assistant: (usage, content = [], extra = {}) => ({
    type: 'assistant',
    message: { id: extra.id || 'msg_' + Math.random().toString(36).slice(2), role: 'assistant', content, usage },
    ...extra,
  }),
  usage: (ctx, out = 100) => ({ input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: ctx - 10 - out, output_tokens: out }),
  toolUse: (id, name, input) => ({ type: 'tool_use', id, name, input }),
  toolResult: (id, content, isError = false) => ({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
  }),
};

function writeTranscript(dir, entries, name = 'sess-1.jsonl') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

function bigFile(dir, name, lines) {
  const body = [];
  for (let i = 1; i <= lines; i++) {
    body.push(i % 50 === 1 ? `function helper${i}(a, b) {` : `  const v${i} = a + b + ${i};`);
    if (i % 50 === 0) body.push('}');
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, body.join('\n') + '\n');
  return file;
}

// Run the hook dispatcher the way Claude Code does: JSON on stdin, env for the project.
function runHook(cmd, input, { projectDir, env = {}, cwd } = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'minctx.js'), cmd], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    cwd: cwd || projectDir,
    env: { ...process.env, HOME: projectDir, USERPROFILE: projectDir, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_ROOT: ROOT, MINCTX_MODE: '', ...env },
    encoding: 'utf8',
  });
  let json = null;
  try {
    json = r.stdout ? JSON.parse(r.stdout) : null;
  } catch {}
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function writeConfig(projectDir, cfg) {
  fs.mkdirSync(path.join(projectDir, '.minctx'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.minctx', 'config.json'), JSON.stringify(cfg));
}

function readLog(projectDir) {
  try {
    return fs
      .readFileSync(path.join(projectDir, '.minctx', 'log.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

module.exports = { ROOT, tmpDir, T, writeTranscript, bigFile, runHook, writeConfig, readLog };
