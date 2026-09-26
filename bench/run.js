#!/usr/bin/env node
'use strict';
// A/B benchmark: same tasks, baseline Claude Code vs. Claude Code + MinCtx.
// We don't optimize for fewer tokens; we optimize for fewer tokens with equivalent outcomes.
//
// Usage: node bench/run.js [--runs 3] [--tasks bench/tasks] [--only name] [--model id]
//                          [--arms baseline,minctx] [--tolerance 0] [--timeout-min 15]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { summarize } = require('../scripts/lib/transcript');

const ROOT = path.resolve(__dirname, '..');
const ALLOWED_TOOLS = 'Read,Grep,Glob,Edit,Write,Bash(node *),Bash(npm test*),Bash(ls *),Bash(git diff*),Bash(git status*)';

function parseArgs(argv) {
  const a = { runs: 3, tasks: path.join(__dirname, 'tasks'), arms: ['baseline', 'minctx'], tolerance: 0, timeoutMin: 15 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--runs') (a.runs = Number(v)), i++;
    else if (k === '--tasks') (a.tasks = path.resolve(v)), i++;
    else if (k === '--only') (a.only = v), i++;
    else if (k === '--model') (a.model = v), i++;
    else if (k === '--arms') (a.arms = v.split(',')), i++;
    else if (k === '--tolerance') (a.tolerance = Number(v)), i++;
    else if (k === '--timeout-min') (a.timeoutMin = Number(v)), i++;
  }
  return a;
}

function loadTasks(dir, only) {
  return fs
    .readdirSync(dir)
    .filter((n) => fs.existsSync(path.join(dir, n, 'task.json')) && (!only || n === only))
    .map((n) => ({ dir: path.join(dir, n), ...JSON.parse(fs.readFileSync(path.join(dir, n, 'task.json'), 'utf8')) }));
}

function findTranscript(sessionId) {
  const base = path.join(os.homedir(), '.claude', 'projects');
  if (!sessionId || !fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base)) {
    const f = path.join(base, d, sessionId + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function runOnce(task, arm, opts) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `minctx-bench-${task.name}-${arm}-`));
  fs.cpSync(path.join(task.dir, 'repo'), ws, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: ws });

  const args = ['-p', task.prompt, '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', ALLOWED_TOOLS];
  if (arm === 'minctx') args.push('--plugin-dir', ROOT);
  // Keep an installed copy of the plugin out of the baseline.
  else args.push('--settings', JSON.stringify({ enabledPlugins: { 'minctx@minctx': false } }));
  if (opts.model) args.push('--model', opts.model);

  const env = { ...process.env };
  delete env.MINCTX_MODE;
  const t0 = Date.now();
  const r = spawnSync('claude', args, { cwd: ws, env, encoding: 'utf8', timeout: opts.timeoutMin * 60000, maxBuffer: 64 * 1024 * 1024 });
  const seconds = (Date.now() - t0) / 1000;

  let out = {};
  try {
    out = JSON.parse(r.stdout);
  } catch {
    out = { is_error: true, result: (r.stderr || r.stdout || String(r.error || '')).slice(0, 500) };
  }
  let input = 0;
  let output = 0;
  for (const m of Object.values(out.modelUsage || {})) {
    input += (m.inputTokens || 0) + (m.cacheReadInputTokens || 0) + (m.cacheCreationInputTokens || 0);
    output += m.outputTokens || 0;
  }

  for (const f of task.checkFiles || []) fs.copyFileSync(path.join(task.dir, f), path.join(ws, f));
  const chk = spawnSync(task.check[0], task.check.slice(1), { cwd: ws, encoding: 'utf8', timeout: 120000 });
  const s = summarize(findTranscript(out.session_id));

  const res = {
    task: task.name,
    arm,
    pass: chk.status === 0,
    agentError: !!out.is_error,
    inputTokens: input,
    outputTokens: output,
    costUsd: out.total_cost_usd || 0,
    turns: out.num_turns || 0,
    toolCalls: s.toolCalls,
    filesRead: new Set(s.reads.map((x) => x.file)).size,
    linesRead: s.reads.reduce((a, x) => a + x.lines, 0),
    seconds,
    workspace: ws,
  };
  if (res.pass) fs.rmSync(ws, { recursive: true, force: true });
  return res;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const METRICS = ['inputTokens', 'outputTokens', 'costUsd', 'turns', 'toolCalls', 'filesRead', 'linesRead', 'seconds'];

// Safe saving = fewer tokens AND pass rate within `tolerance` of the baseline.
function aggregate(results, tolerance = 0) {
  const arms = {};
  for (const r of results) (arms[r.arm] = arms[r.arm] || []).push(r);
  const summary = {};
  for (const [arm, rs] of Object.entries(arms)) {
    summary[arm] = { n: rs.length, passRate: rs.filter((r) => r.pass).length / rs.length };
    for (const m of METRICS) summary[arm][m] = mean(rs.map((r) => r[m]));
  }
  const b = summary.baseline;
  const o = summary.minctx;
  let verdict = null;
  if (b && o) {
    const delta = {};
    for (const m of METRICS) delta[m] = b[m] ? (o[m] - b[m]) / b[m] : 0;
    const qualityOk = o.passRate >= b.passRate - tolerance;
    const saved = o.inputTokens + o.outputTokens < b.inputTokens + b.outputTokens;
    verdict = { delta, qualityOk, saved, safeSaving: qualityOk && saved };
  }
  return { summary, verdict };
}

function table({ summary, verdict }, tolerance) {
  const pct = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
  const fmt = (m, v) => (m === 'costUsd' ? '$' + v.toFixed(4) : m === 'seconds' ? v.toFixed(0) + 's' : Math.round(v).toLocaleString('en-US'));
  const b = summary.baseline;
  const o = summary.minctx;
  const rows = ['| metric | baseline | minctx | change |', '|---|---:|---:|---:|'];
  rows.push(`| pass rate | ${b ? (b.passRate * 100).toFixed(0) + '%' : '-'} | ${o ? (o.passRate * 100).toFixed(0) + '%' : '-'} | |`);
  for (const m of METRICS) {
    rows.push(`| ${m} | ${b ? fmt(m, b[m]) : '-'} | ${o ? fmt(m, o[m]) : '-'} | ${verdict ? pct(verdict.delta[m]) : ''} |`);
  }
  if (verdict) {
    rows.push('');
    rows.push(`Safe saving: ${verdict.safeSaving ? 'PASS' : 'FAIL'} (quality ${verdict.qualityOk ? 'held' : 'dropped'} within ${tolerance * 100}pp, tokens ${verdict.saved ? 'saved' : 'not saved'})`);
    const n = Math.min(b.n, o.n);
    if (n < 10) rows.push(`Note: n=${n} runs per arm; treat as a smoke test, not a statistically meaningful result.`);
  }
  return rows.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const tasks = loadTasks(opts.tasks, opts.only);
  if (!tasks.length) {
    console.error('No tasks found in ' + opts.tasks);
    process.exit(1);
  }
  const results = [];
  for (const task of tasks) {
    for (let i = 0; i < opts.runs; i++) {
      // Alternate arm order so neither arm systematically benefits from a warm cache.
      const arms = i % 2 ? [...opts.arms].reverse() : opts.arms;
      for (const arm of arms) {
        process.stderr.write(`[${task.name}] run ${i + 1}/${opts.runs} ${arm} ... `);
        const r = runOnce(task, arm, opts);
        process.stderr.write(`${r.pass ? 'PASS' : 'FAIL'} in=${r.inputTokens} out=${r.outputTokens}${r.pass ? '' : ' ws=' + r.workspace}\n`);
        results.push(r);
      }
    }
  }
  const agg = aggregate(results, opts.tolerance);
  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify({ opts, results, ...agg }, null, 2));
  console.log(table(agg, opts.tolerance));
  console.log(`\nRaw results: ${path.relative(process.cwd(), file)}`);
}

if (require.main === module) main();
module.exports = { aggregate, table, parseArgs, loadTasks };
