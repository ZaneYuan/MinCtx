---
name: limit
description: Show or set the context size at which MinCtx hands off to a fresh session, e.g. /minctx:limit 450k (heads-up defaults to 80%), /minctx:limit 450k 350k, off, on.
argument-hint: "[hard] [soft] | off | on"
disable-model-invocation: true
allowed-tools: Bash(node *)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/minctx.js" limit $ARGUMENTS`

Show the output above to the user verbatim. No commentary.
