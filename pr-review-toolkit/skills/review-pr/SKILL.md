---
name: review-pr
description: >-
  Conduct a comprehensive PR review of the current checkout and return an
  interactive review board
disable-model-invocation: true
allowed-tools:
  - ExitPlanMode
  - Workflow
  - AskUserQuestion
  - Read
  - Bash(git rev-parse *)
  - Bash(git status *)
  - Bash(git config --get-regexp *)
  - Bash(git remote get-url origin *)
  - Bash(cut *)
  - Bash(git fetch origin *)
  - Bash(git merge-base *)
  - Bash(git rev-list *)
  - Bash(git diff *)
  - Bash(git --literal-pathspecs diff *)
  - mcp__plugin_github_github__get_me
  - mcp__plugin_github_github__pull_request_read
  - mcp__plugin_github_github__search_pull_requests
  - mcp__plugin_github_github__list_pull_requests
  - mcp__plugin_github_github__pull_request_review_write
  - mcp__plugin_github_github__add_comment_to_pending_review
  - mcp__plugin_github_github__add_reply_to_pull_request_comment
---

# PR Review

## Precondition

This skill takes no arguments. The current directory must be a git checkout
of the PR head commit — a Claude Code worktree (`claude --worktree "#123"`),
`gh pr checkout N`, or the author's own up-to-date branch.

## Environment

- Head SHA: !`git rev-parse HEAD`
- Checkout root: !`git rev-parse --show-toplevel`
- Branch: !`git rev-parse --abbrev-ref HEAD`
- Origin: !`git remote get-url origin | cut -d@ -f2-`
- Branch config: !`git config --get-regexp '^branch\..*\.merge$'`
- Dirty files: !`git status --porcelain`

## Constraints

Use only `allowed-tools`. Do not generate ad-hoc processing scripts. Workflow
return values and MCP responses are structured JSON; read them directly. Bash
is limited to the read-only git commands used below plus one `git fetch` of
the base branch. The workflow and its agents are read-only. GitHub write
tools may be used only after an exact preview and explicit final posting
approval from the user.

## Exit Plan Mode

If plan mode is active, call `ExitPlanMode` now before proceeding.

## Resolve The PR

Determine which PR this checkout belongs to, from the Environment values
above. Origin's host must be github.com; parse `{owner}/{repo}` from it. The
next section verifies the candidate's head SHA, so resolution only has to
produce the right candidate, not prove it. In the same turn as the first
GitHub call, also call `get_me` (see Identify The Reviewer) and Read
`${CLAUDE_SKILL_DIR}/references/board.md`; neither depends on the PR. Use the
first route that yields one:

1. **Branch config** — if the current branch's `merge` key in Branch config
   is `refs/pull/N/head` (as `gh pr checkout` writes for fork checkouts), N
   is the PR number.
2. **Head filter** — on a named branch, call `list_pull_requests` with state
   `open`, head `{owner}:{branch}` (an exact server-side filter), and
   `fields: ["number", "head"]`.
3. **SHA scan** — otherwise: scan `list_pull_requests` with state `open`,
   `perPage: 100`, and `fields: ["number", "head"]` to the last page for
   `head.sha` equal to the Head SHA. `search_pull_requests` with query
   `repo:{owner}/{repo} is:pr is:open {headSha}` may suggest a candidate
   first, but it is only a hint: its index lags recent pushes and matches PRs
   that merely mention the SHA.

Exactly one open PR matches: proceed. Zero or several: stop with an honest
error naming the SHA and repository checked and the fix (check out the PR
head, push commits, or pick one PR).

## Fetch PR Metadata

Call `pull_request_read` with method `get`. Record: title, body, author,
state, `base.ref`, the base repository full name, head SHA, and
`mergeable_state` (the MCP response carries no `mergeable` boolean). When passing the body to the workflow, leave
out `<!-- ... -->` HTML-comment blocks (template instructions and bot
markers); keep everything else, including `<details>` content.

Verify the Environment Head SHA equals the PR's head SHA. On mismatch, stop
with an honest error and name the fix: unpushed local commits need a push
first, and a stale checkout after a new push needs the new head fetched and
checked out. Also verify the PR state is open — the branch-config route can
resolve an already-merged PR whose head still matches; stop honestly if not.

If Dirty files is non-empty, warn but do not block (file reads see
uncommitted edits; the diff itself is tree-to-tree).

## Identify The Reviewer

Call `get_me` once, alongside the first GitHub call of Resolve The PR, and
record its `login` as `reviewerLogin`. If it fails, warn that follow-up
detection is unavailable this run and continue with `reviewerLogin` empty.

## Pin The Review Range

Verify Origin points at the PR's base repository from the metadata (a fork
clone points at the fork and would compute a wrong merge base); stop
honestly on mismatch. `base.ref` is remote data: stop unless it matches
`^[A-Za-z0-9._/-]+$`.

Fetch the base branch unconditionally (the skill's only network git command),
so the base is current at review time, then pin the range and measure base
movement against `FETCH_HEAD` — exact regardless of the clone's refspec
configuration. Run all three as one Bash call:

```bash
git fetch origin refs/heads/<base.ref> && git merge-base FETCH_HEAD HEAD && git rev-list --count HEAD..FETCH_HEAD
```

The fetch's own progress lines vary, so read the last two lines of output:
`merge_base` (a 40-hex SHA), then `base_ahead_count` (an integer: commits on
the base not in the PR). The fully qualified ref cannot be parsed
as an option or a tag of the same name. If the fetch fails, stop honestly and
quote its error. If `merge-base` fails, the checkout is likely shallow: stop
honestly and suggest `git fetch --unshallow origin`.

## Launch Analysis Workflow

Invoke the Workflow tool with:

- `name`: `pr-review-toolkit:review-pr-analysis`
- `args`:
  - `pr`: `{ owner, repo, number, title, body, author, state, baseRef,
    headSha }` from the metadata
  - `checkoutPath`: the Environment Checkout root
  - `mergeBase`: the pinned `merge_base`
  - `reviewerLogin`: the login from Identify The Reviewer (omit when empty)

If the tool reports that workflow name is not found (older Claude Code
versions do not register plugin workflows), invoke it again with
`scriptPath`: `${CLAUDE_SKILL_DIR}/review-pr.js` and the same `args`. If
that also fails, stop with an honest error quoting both failures and
suggest updating Claude Code.

No bulk data rides `args` — workflow agents gather their own diff context
from the checkout, and the workflow returns grouped findings with review
metadata.

## Present Review Board And Ask What To Do Next

Follow `${CLAUDE_SKILL_DIR}/references/board.md` (read during Resolve The
PR; read it now if it is not already in context) exactly. Present the board
before drafting or posting anything.

## Drafting And Posting

When the user chooses to draft, reply, approve, or post, read
`${CLAUDE_SKILL_DIR}/references/posting.md` and follow it exactly. It
governs drafting style, line-anchor validity, the exact preview, explicit
approval, and the approved GitHub writes. Before any posting question, the
user must see the exact draft text in a `### Review preview` block, following
the numbered steps in `posting.md`.
