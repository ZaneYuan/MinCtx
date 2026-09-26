---
name: limit
description: Set MinCtx context rollover thresholds, e.g. /minctx:limit 450k (soft defaults to 80% of hard).
disable-model-invocation: true
allowed-tools: Bash(node *)
---
Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/minctx.js" limit $ARGUMENTS`

Show its output to the user in one line. No commentary.
