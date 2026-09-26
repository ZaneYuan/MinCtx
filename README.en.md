# MinCtx

[中文](README.md) | **English**

### A Claude Code plugin that actually saves you money and usage quota

Covers input, output and working practice.

| Reads only what it needs | Replies concisely | Does just enough |
|:---:|:---:|:---:|
| Large files read on demand; long sessions handed off | No preamble, no recaps, just results | Smallest correct change, no over-engineering |

No heavy rulebook: about 270 tokens of direction, plus two safeguards enforced by hooks.

---

## How it works

Claude Code replays the full conversation on every request, so most token spend is input, and it compounds as a session grows. MinCtx intervenes at these points:

| Where the waste comes from | What MinCtx does | Hook |
|---|---|---|
| **Reads**: reading a thousand-line file to change one line, then re-sending it every turn | Unbounded reads of files over 300 lines are denied with a line-numbered outline; ranged reads pass. Covers Read; Bash `cat`, `nl`, `head`, `tail`, `sed -n`; PowerShell `Get-Content`, `gc`, `type` | `PreToolUse` |
| **Long sessions**: every message is billed at full context; `/compact` itself reads the full context | At turn end, context size is checked; above the limit a ~1–2K handoff is written and injected after `/clear` | `Stop`<br>`SessionStart` |
| **Messages past the limit**: the next message sent after the limit is reached | Held rather than sent, and folded into the handoff for the new session | `UserPromptSubmit` |
| **Output and behaviour**: verbose replies, over-implementation, exploratory reads | Session protocol (~270 tokens): scope first, search before read, minimal change, no recaps | `SessionStart` |

How this differs from `/compact`: `/compact` turns a long conversation into a shorter one; MinCtx turns it into executable state. Code and git history stay out of the handoff, since the repository is the source of truth. The handoff holds only what the repo can't tell a fresh session:

- `state.md`: goal, done, decisions and why, blockers, next step, maintained incrementally by the agent at milestones
- files modified this session (paths only)
- the last test/build command and its result
- the held prompt
- the previous transcript path, so a detail can be looked up on demand rather than replayed

A running turn is never interrupted. Its input is already paid for, so the hand-off happens at turn end.

## Design: direction, not shackles

A capable agent doesn't need thousands of lines of rules to do good work. Longer rule sets cost tokens in every session, and are more likely to conflict with each other or box the agent in. MinCtx takes a different approach:

- **Direction through rules**: a ~270-token protocol is injected once per session. It states direction and principles and leaves the how to the agent.
- **Enforcement where it matters**: the two things that cost the most and can be judged unambiguously (whole-file reads of large files, and carrying a long session forward) don't depend on the agent's discretion. Hooks enforce them (see the table above).

### The full rules

This is everything injected into the agent; there are no other hidden instructions (source: [`rules/protocol.md`](rules/protocol.md)):

```text
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
```

| Principle | Meaning | Why |
|---|---|---|
| Overall | Fewest tokens for an equivalent result; never drop constraints or unresolved information | Saving tokens must never cost requirements |
| READ LESS | Decide what the task needs; skip README, architecture and unrelated modules unless they'd change the next action | Anything read stays in context and is billed again every turn |
| | Grep/Glob to locate, then read only the relevant 50–150 lines; expand one hop (callee, interface, model) only when blocked | Locate on demand instead of "understanding the whole project" first |
| | Don't re-read unchanged content; don't read "for completeness"; keep only failures or the tail of command output | Don't pay for the same content twice |
| DO LESS | Smallest correct change; reuse existing code and dependencies; no speculative abstractions, refactors or extra files; stop once solved and verified | Extra changes cost tokens and widen the surface for bugs and review |
| SAY LESS | No preamble, no restating the request, no diff recap; report what changed, the result, and anything the user must decide; detail on request | Output tokens cost more than input |
| CARRY LESS | At milestones, rewrite `.minctx/state.md` (≤25 lines): goal / done / decisions and why / blockers / next; never copy code or file contents | The repo and git are the memory; a handoff carries only what they can't recover |
| | After a handoff, trust it plus the repo; look up missing details in the previous transcript rather than guess | Nothing is lost for good |

## Install

Requires Node.js ≥ 18 (hooks run on Node). Windows, macOS and Linux.

```text
/plugin marketplace add ZaneYuan/MinCtx
/plugin install minctx@minctx
```

Restart Claude Code afterwards. For local development: `claude --plugin-dir <local path>` (a path, not a URL).

To check it's active: a self-ignoring `.minctx/` directory appears in the project, and `/minctx:stats` prints a report.

## Usage

Nothing changes in day-to-day use. Near the limit, this is what happens:

1. **Context reaches 80% of the limit** (default 360K): one notice after the turn.
2. **Context reaches the limit** (default 450K): the current turn completes normally, the agent updates `state.md`, the plugin writes `.minctx/handoff.md` and prompts you to `/clear`.
3. Run `/clear`, then send "continue": the new session resumes from the handoff.
4. If you send a message past the limit without `/clear`, it isn't sent or billed, and is folded into the handoff. Prefix a message with `++` to force it into the current session. Slash commands always pass.

**On models with a 200K context window**, run `/minctx:limit 150k`. Otherwise Claude Code auto-compacts before 450K and the hand-off never triggers.

## Commands

| Command | Description |
|---|---|
| `/minctx:stats` | Context size, input/output tokens, lines read, tool calls and guard actions for this session |
| `/minctx:limit [hard] [soft] \| off \| on` | Show or set the hand-off limit (global); `soft` defaults to 80% of `hard` |
| `/minctx:checkpoint` | Write a handoff now, e.g. between tasks, then `/clear` |

All three use `disable-model-invocation`, so they take no context until you invoke them.

## Configuration

Merged in order, later wins: built-in defaults → `~/.minctx/config.json` → `<project>/.minctx/config.json` → `MINCTX_MODE` env var.

```json
{
  "mode": "enforce",
  "readGuard": { "enabled": true, "maxLines": 300, "outlineEntries": 40 },
  "rollover": {
    "enabled": true,
    "hardTokens": 450000,
    "softRatio": 0.8,
    "refreshState": true,
    "overridePrefix": "++",
    "handoffMaxAgeHours": 24
  },
  "handoff": { "maxChars": 8000 }
}
```

- `mode`: `enforce` acts · `shadow` only logs intended actions to `.minctx/log.jsonl`, changing nothing · `off` disables
- `rollover.refreshState`: at the limit, have the agent refresh `state.md` before the handoff is written
- `softTokens`: when unset, `hardTokens × softRatio`

## Verification

The target is fewer tokens with equivalent outcomes, not fewer tokens alone. `bench/run.js` runs the same tasks under baseline and MinCtx conditions and grades the results with acceptance tests the agent never sees:

```bash
node bench/run.js --runs 3        # needs a logged-in claude CLI; incurs API cost
```

The verdict is `Safe saving: PASS` only if the MinCtx pass rate is no lower than baseline (tolerance set with `--tolerance`) and total tokens are lower. Raw results go to `bench/results/`.

Results vary by project and working style, so try it yourself: `/minctx:stats` shows what the current session is spending, and the benchmark quantifies the difference with and without the plugin. Results are welcome in [Issues](https://github.com/ZaneYuan/MinCtx/issues). No published benchmark results yet. To add a task: `bench/tasks/<name>/{repo/, task.json, <acceptance test>}`.

## Limitations

- Hooks can't open a new session themselves, so a manual `/clear` is needed after the hand-off.
- Context size comes from the usage of the latest main-thread request in the transcript. A single very long turn can end well past the limit.
- The read guard judges single simple commands; pipelines and compound commands are treated as already filtered and pass.
- The behaviour protocol is an instruction to the model and isn't guaranteed; the read guard and hand-off are enforced.

## Development

```bash
npm test                        # unit + hook end-to-end tests, no model calls
claude plugin validate .
```

```text
hooks/hooks.json    SessionStart / UserPromptSubmit / PreToolUse / Stop
rules/protocol.md   session behaviour protocol
scripts/minctx.js   hook entry; checkpoint / limit commands
scripts/lib/        config · transcript · guard · state
scripts/stats.js    session stats
skills/             checkpoint · stats · limit
bench/              A/B benchmark
```

Roadmap: CLI wrapper for hand-off without `/clear`; more benchmark tasks; tool-output compression.

## Try it

Give it a try. For questions, suggestions or benchmark results, open an [Issue](https://github.com/ZaneYuan/MinCtx/issues) or email [1447596534@qq.com](mailto:1447596534@qq.com).

## License

[MIT](LICENSE)
