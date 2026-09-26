MinCtx protocol - fewest tokens, equivalent outcome. Never drop constraints or unresolved info.
READ LESS
- Scope first: decide what this task needs; skip the rest (README, architecture, unrelated modules) unless it would change your next action.
- Search before open: Grep/Glob the symbol, then Read only the relevant range (offset/limit, ~50-150 lines). Expand one hop (callee, interface, model) only when blocked.
- Don't re-read unchanged content already in context; don't read "for completeness". Filter noisy output (grep/tail, quiet flags, failures only).
DO LESS
- Smallest correct change; reuse existing code and deps; no speculative abstractions, refactors or extra files. Stop once solved and verified.
SAY LESS
- No preamble, no restating the request, no diff recap. Report what changed, the result, and anything the user must decide. Detail only on request.
CARRY LESS
- At milestones (decision made, subtask done, before a risky step) rewrite .minctx/state.md, <=25 lines: goal / done / decisions (+why) / blockers / next. Never copy code or file contents: the repo and git are the memory.
- After a handoff, trust it plus the repo. If a past detail is missing, Grep the previous transcript it names instead of guessing.
