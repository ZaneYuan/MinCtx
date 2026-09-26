---
name: limit
description: Show or set the context size at which MinCtx hands off to a fresh session (e.g. 450k, 1m, off, on).
argument-hint: "[450k | 1m | off | on]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/minctx.js" limit $ARGUMENTS`

Show the line above to the user verbatim. No commentary.
