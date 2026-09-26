# MinCtx

[中文](README.md) | **English**

**A Claude Code plugin that spends fewer tokens: read less, do less, say less, carry less — with the same results.**

Install it and keep using Claude Code exactly as before. MinCtx works in the background:

- **Long conversations roll over to a fresh session.** Near the limit, progress is saved as a 1–2K-token note and work continues in a new session, instead of dragging hundreds of thousands of tokens of history along.
- **Work in progress is never interrupted.** MinCtx stays out of the way while Claude is working and only checks once the turn is finished.
- **The most expensive message never gets sent.** Past the limit, your next message is held (free) and carried into the new session.
- **No whole-file reads of huge files.** When Claude tries to read a file with thousands of lines, it gets an outline first and reads only the few dozen lines it needs.

> We don't optimize for fewer tokens. We optimize for fewer tokens with equivalent outcomes.

---

## Contents

1. [Why you need it](#1-why-you-need-it)
2. [Install](#2-install)
3. [Check it works](#3-check-it-works)
4. [Everyday use: what you'll see](#4-everyday-use-what-youll-see)
5. [Three commands](#5-three-commands)
6. [FAQ](#6-faq)
7. [Advanced configuration](#7-advanced-configuration)
8. [Proving the savings are safe](#8-proving-the-savings-are-safe)
9. [Update and uninstall](#9-update-and-uninstall)

---

## 1. Why you need it

Every time Claude replies, it re-reads the **entire conversation so far**, and you pay (or spend quota) for all of it.

| Conversation length | You ask "done yet?" | What actually gets processed |
|---|---|---|
| Just started | Cheap | A few K tokens |
| All afternoon | Expensive | Possibly hundreds of thousands of tokens |

That's why a single casual question can eat a big chunk of your usage limit.

Two other common sources of waste:

- Claude reads a thousand-line file in full to change one line. Everything it read is then carried, and billed, again on every later message.
- The built-in `/compact` has to read the whole oversized conversation before it can summarize it, which is expensive in itself.

MinCtx's idea: **the cheapest token is the one you never load.** Don't read what you don't need. When a conversation gets too long, start a clean session and bring only the essential progress with you.

---

## 2. Install

**Requirement:** [Node.js](https://nodejs.org/) 18 or newer (check with `node -v`). Works on Windows, macOS and Linux.

### Option A: install from inside Claude Code (recommended)

In the Claude Code prompt, type:

```text
/plugin marketplace add ZaneYuan/MinCtx
/plugin install minctx@minctx
```

Then **quit and restart Claude Code** so the plugin takes effect.

### Option B: clone locally and launch with it

Run this in your terminal (PowerShell / Terminal), **not in the Claude prompt**:

```bash
git clone https://github.com/ZaneYuan/MinCtx
cd your-project
claude --plugin-dir /path/to/MinCtx
```

> ⚠️ `--plugin-dir` takes a **local folder path**, not a GitHub URL.

---

## 3. Check it works

1. Open Claude Code in any project. A `.minctx` folder appears in the project directory. It git-ignores itself, so it is never committed.
2. Type `/minctx:stats` in Claude. You should see something like:

```text
MinCtx stats · session 6bfa5c84
Context now      82.1K tokens (soft 360K · hard 450K)
Requests         32
Input processed  3.47M (new 64 · cache write 111.3K · cache read 3.36M)
Output           53.1K
Tool calls       36 (Bash 20, Write 10, Read 1, Edit 1)
Reads            1 of 1 files, ~1250 lines (ranged 0 · full 1)
Guard            2 reads narrowed · 0 hand-offs · 0 handoffs loaded
```

3. (Optional) Ask Claude to read a file with more than 300 lines. It gets the file's outline first, then reads only the lines it needs.

---

## 4. Everyday use: what you'll see

**Most of the time you do nothing.** You'll only see messages once a conversation gets long.

### Case 1: the conversation reaches 80% of the limit (default 360K)

After a turn finishes, you get one notice:

```text
MinCtx: context is 380K tokens (hand-off at 450K).
If the current task is done, /minctx:checkpoint then /clear starts the next one cheaply.
```

The conversation is getting long. If you've just finished something, now is the cheapest moment to start fresh. **You don't have to**; it's only a heads-up.

### Case 2: the conversation reaches the limit (default 450K)

Claude **finishes its current turn normally** and is never cut off mid-work. At the end it jots a few lines of progress, then you see:

```text
MinCtx: this turn finished at 460K tokens (limit 450K).
Handoff saved (~1200 tokens). Run /clear, then send "continue" to keep going in a fresh session.
```

Two steps:

1. Type `/clear` to start a clean session.
2. Send `continue`.

The new session automatically receives the handoff note (goal, what's done, decisions, files changed, next step) and carries on. The code is on disk and Claude reads it when needed, so none of the old conversation has to come along.

### Case 3: you send a message after the limit without switching

That message is **not sent and costs nothing**. It's saved into the handoff:

```text
MinCtx: this session is at 460K tokens (limit 450K), so this message was NOT sent and cost nothing.
It is saved in the handoff (~1200 tokens). Run /clear, then send "continue".
To send it to this session anyway, start the message with "++".
```

Just `/clear` and send `continue`; the new session answers that message.

**Want to send it to the old session anyway?** Start the message with `++`, e.g. `++ one more look at this function`.

> Slash commands such as `/clear` are never blocked.

### Case 4: Claude says a file is "too long, use the outline"

This is expected, and Claude handles it itself: it uses the outline to locate the code, then reads just those lines. If it genuinely needs the whole file, it asks for the full line range explicitly and won't be blocked.

---

## 5. Three commands

| Command | What it does |
|---|---|
| `/minctx:stats` | Usage for this session: context size, lines read, tool calls, guard actions |
| `/minctx:limit` | Show or change the hand-off limit (applies to all projects) |
| `/minctx:checkpoint` | Save a handoff now. Useful between tasks, followed by `/clear` |

`/minctx:limit` usage:

```text
/minctx:limit            show current settings
/minctx:limit 450k       limit 450K, heads-up at 80% (360K)
/minctx:limit 450k 350k  set limit and heads-up explicitly
/minctx:limit 150k       for models with a 200K context window
/minctx:limit off        turn automatic hand-off off (read guard stays on)
/minctx:limit on         turn it back on
```

These commands take **zero context** until you invoke them.

---

## 6. FAQ

**Q: My model has a 200K context window. Do I need to change anything?**
Yes, run `/minctx:limit 150k`. Otherwise Claude Code compacts on its own before you ever reach 450K, and MinCtx's hand-off never triggers.

**Q: Is anything lost when switching sessions?**
The handoff includes the goal, what's done, decisions and why, files changed, the last test result and the next step. The code itself is on disk, so it isn't copied. The full old transcript is kept too, and its path is in the handoff, so the new session can look up a specific detail instead of guessing.

**Q: Will it ever interrupt Claude halfway through a task?**
No. Checks only happen **after a turn finishes**. The trade-off: if Claude works for a long time in a single turn, that turn may end well past the limit.

**Q: Does it hurt answer quality?**
The rule is to drop only information that wouldn't change the correct next step. You can verify this yourself with the A/B benchmark in section 8.

**Q: I want to watch it first without it blocking anything.**
Use shadow mode: put `{"mode": "shadow"}` in the project's `.minctx/config.json`. MinCtx only logs what it *would* have done (to `.minctx/log.jsonl`) and changes nothing.

**Q: How do I turn it off completely?**
Put `{"mode": "off"}` in `.minctx/config.json`, or disable or uninstall the plugin from the `/plugin` menu.

---

## 7. Advanced configuration

Config files are merged in this order, later ones winning:

1. Built-in defaults
2. `~/.minctx/config.json`: global; `/minctx:limit` writes here
3. `<project>/.minctx/config.json`: this project only
4. The `MINCTX_MODE` environment variable

Full example (all defaults):

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

| Key | Meaning |
|---|---|
| `mode` | `enforce`: normal; `shadow`: log only; `off`: disabled |
| `readGuard.maxLines` | Files longer than this can't be read whole in one go (default 300) |
| `rollover.hardTokens` | Hand-off limit |
| `rollover.softTokens` / `softRatio` | Heads-up point; without `softTokens` it is limit × `softRatio` |
| `rollover.refreshState` | Let Claude refresh its progress note before the handoff (default on) |
| `rollover.overridePrefix` | Prefix that sends a message to the old session anyway (default `++`) |
| `rollover.handoffMaxAgeHours` | How long a handoff stays valid (default 24h) |

Reads are guarded across the Read tool; Bash `cat`, `cat -n`, `nl`, `head`, `tail`, `sed -n`; and PowerShell `Get-Content`, `gc`, `type`. The check is based on **how many lines the command actually reads**. Small ranged reads and filtered pipelines (e.g. `cat file | grep x`) pass normally.

---

## 8. Proving the savings are safe

Saving 80% of tokens while shipping 10% more bugs is not a win. MinCtx ships an A/B benchmark: the same tasks run **with and without the plugin**, and hidden acceptance tests (which Claude never sees) judge the results.

```bash
node bench/run.js --runs 3     # needs a logged-in claude CLI; costs API usage
```

The last line is the verdict:

```text
Safe saving: PASS (quality held within 0pp, tokens saved)
```

It's only a PASS when **the pass rate didn't drop and tokens actually went down**.

> No published measurements yet. Results posted as Issues are welcome.

To add a task, create `bench/tasks/<name>/` with `repo/` (starting code), `task.json` (prompt and check command) and the hidden acceptance test.

---

## 9. Update and uninstall

```text
/plugin marketplace update minctx    update, then restart Claude Code
/plugin uninstall minctx@minctx      uninstall
```

After uninstalling, you can delete the `.minctx` folder in your projects.

---

## For developers

```bash
npm test                          # unit + hook end-to-end tests (no model calls)
claude plugin validate .          # validate the plugin manifest
```

```text
.claude-plugin/     plugin.json, marketplace.json
hooks/hooks.json    SessionStart / UserPromptSubmit / PreToolUse / Stop
rules/protocol.md   behaviour rules injected once per session (~270 tokens)
scripts/minctx.js   hook entry point + checkpoint / limit commands
scripts/stats.js    session stats
scripts/lib/        config / transcript / guard / state(handoff)
skills/             /minctx:checkpoint, /minctx:stats, /minctx:limit
bench/              A/B benchmark and tasks
test/               node:test
```

**Known limits**

- Claude Code hooks can't open a new session themselves, so you type `/clear` once.
- The behaviour rules (read less, say less) are instructions to the model and aren't guaranteed; the read guard and session hand-off are enforced.

**Roadmap**: one-step hand-off without manual `/clear` (CLI wrapper), more benchmark tasks, tool-output compression.
