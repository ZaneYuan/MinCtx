---
name: checkpoint
description: Save a minimal task handoff and prepare a fresh session. Use instead of /compact.
disable-model-invocation: true
allowed-tools: Bash(node *), Write, Edit
---
Roll this session over to a fresh one without summarizing the conversation.

1. Rewrite `.minctx/state.md` (<=25 lines): goal / done / decisions (+why) / blockers / next.
   Only what the repo and git cannot tell a fresh session. No code, no file contents, no history of failed attempts beyond one line each.
2. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/minctx.js" checkpoint`
3. Reply in one line: the handoff size from the output, then "Run /clear, then send 'continue'."
