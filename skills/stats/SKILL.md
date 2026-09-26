---
name: stats
description: Show this session's context-efficiency stats (tokens, reads, tool calls, guard actions).
disable-model-invocation: true
allowed-tools: Bash(node *)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/stats.js"`

Show the stats above to the user verbatim in a code block. No commentary.
