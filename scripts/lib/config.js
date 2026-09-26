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
    // Context size (tokens) of the last request. Soft: nudge to checkpoint. Hard: block and hand off.
    // softTokens null means 80% of hardTokens.
    softTokens: null,
    hardTokens: 450000,
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
  let cfg = merge(DEFAULTS, readJson(path.join(os.homedir(), '.minctx', 'config.json')));
  if (projectDir) cfg = merge(cfg, readJson(path.join(projectDir, '.minctx', 'config.json')));
  if (process.env.MINCTX_MODE) cfg.mode = process.env.MINCTX_MODE;
  if (cfg.rollover.softTokens == null) {
    cfg.rollover = { ...cfg.rollover, softTokens: Math.round(cfg.rollover.hardTokens * 0.8) };
  }
  return cfg;
}

module.exports = { DEFAULTS, loadConfig, merge, readJson };
