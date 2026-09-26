# MinCtx

## Git attribution
- Never add Claude/AI attribution to commits or pull requests in this repo: no `Co-Authored-By: Claude ...` trailer, no `Claude-Session:` line, no "Generated with Claude Code" text.
- Author and committer must both be the repo owner, never `Claude <noreply@anthropic.com>`. Before the first commit in a session, run:
  `git config user.name ZaneYuan && git config user.email jacquaribtonoaq@gmail.com`
- Verify with `git log -1 --format='%an <%ae> / %cn <%ce>'` before pushing.

## Branching
- Work and push directly on `main`. Only create a new branch when the user explicitly asks for one.
