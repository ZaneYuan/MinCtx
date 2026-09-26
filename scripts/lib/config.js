'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  // enforce: block/deny. shadow: only log what would have happened. off: do nothing.
  mode: 'enforce',
  readGuard: {
    enabled: true,
    // Unbounded reads of files longer than this are denied with an outline.
    maxLines: 300,
    outlineEntries: 40,
  },
  rollover: {
    enabled: true,
    // Context size (tokens) of the last request. Checked when a turn ends, never mid-turn.
    // Hard: hand off to a fresh session. Soft: one early heads-up. softTokens null = softRatio * hard.
    hardTokens: 450000,
    softTokens: null,
    softRatio: 0.8,
    // At the hard limit, ask Claude for one short state.md refresh before the handoff is written.
    refreshState: true,
    // Prompts starting with this prefix bypass the hard limit once.
    overridePrefix: '++',
    // A pending handoff older than this is ignored at session start.
    handoffMaxAgeHours: 24,
  },
  handoff: {
    maxChars: 8000,
  },
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Precedence: defaults < ~/.minctx/config.json < <project>/.minctx/config.json < MINCTX_MODE env.
function loadConfig(projectDir) {
  let cfg = merge(JSON.parse(JSON.stringify(DEFAULTS)), readJson(path.join(os.homedir(), '.minctx', 'config.json')));
  if (projectDir) cfg = merge(cfg, readJson(path.join(projectDir, '.minctx', 'config.json')));
  if (process.env.MINCTX_MODE) cfg.mode = process.env.MINCTX_MODE;
  const r = cfg.rollover;
  if (!(r.softTokens > 0)) r.softTokens = Math.round(r.hardTokens * r.softRatio);
  return cfg;
}

// "450k", "1m", "450000" -> tokens. Returns null when unparseable.
function parseTokens(v) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([km]?)\s*$/i.exec(String(v));
  if (!m) return null;
  const n = Number(m[1]) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1);
  return Math.round(n);
}

module.exports = { DEFAULTS, loadConfig, merge, readJson, parseTokens };
