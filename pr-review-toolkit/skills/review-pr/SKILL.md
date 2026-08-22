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
- Branch config: !`git config --get-regexp '^branch\.'`
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
produce the right candidate, not prove it. Use the first route that yields
one:

1. **Branch config** — if the current branch's `merge` key in Branch config
   is `refs/pull/N/head` (as `gh pr checkout` writes for fork checkouts), N
   is the PR number.
2. **Head filter** — on a named branch, call `list_pull_requests` with state
   `open` and head `{owner}:{branch}` — an exact server-side filter.
3. **SHA search** — otherwise: `search_pull_requests` with query
   `repo:{owner}/{repo} is:pr is:open {headSha}`, confirming each
   candidate's head SHA via its metadata. If none is confirmed (the index
   lags recent pushes and matches PRs that merely mention the SHA), scan
   `list_pull_requests` state `open` to the last page for `head.sha` equal
   to the Head SHA.

Exactly one open PR matches: proceed. Zero or several: stop with an honest
error naming the SHA and repository checked and the fix (check out the PR
head, push commits, or pick one PR).

## Fetch PR Metadata

Call `pull_request_read` with method `get`. Record: title, body, author,
state, `base.ref`, the base repository full name, head SHA, and
`mergeable` / `mergeable_state`.

Verify the Environment Head SHA equals the PR's head SHA. On mismatch, stop
with an honest error and name the fix: unpushed local commits need a push
first, and a stale checkout after a new push needs the new head fetched and
checked out. Also verify the PR state is open — the branch-config route can
resolve an already-merged PR whose head still matches; stop honestly if not.

If Dirty files is non-empty, warn but do not block (file reads see
uncommitted edits; the diff itself is tree-to-tree).

## Pin The Review Range

Verify Origin points at the PR's base repository from the metadata (a fork
clone points at the fork and would compute a wrong merge base); stop
honestly on mismatch. `base.ref` is remote data: stop unless it matches
`^[A-Za-z0-9._/-]+$`.

Fetch the base branch unconditionally (the skill's only network git command),
so the base is current at review time, then pin the range and measure base
movement against `FETCH_HEAD` — exact regardless of the clone's refspec
configuration:

```bash
git fetch origin refs/heads/<base.ref>
git merge-base FETCH_HEAD HEAD                 # record as merge_base
git rev-list --count <merge_base>..FETCH_HEAD  # record as base_ahead_count
```

The fully qualified ref cannot be parsed as an option or a tag of the same
name. If `merge-base` fails, the checkout is likely shallow: stop honestly
and suggest `git fetch --unshallow origin`.

## Launch Analysis Workflow

Invoke the Workflow tool with:

- `scriptPath`: `${CLAUDE_SKILL_DIR}/review-pr.js`
- `args`:
  - `pr`: `{ owner, repo, number, title, body, author, state, baseRef,
    headSha }` from the metadata
  - `checkoutPath`: the Environment Checkout root
  - `mergeBase`: the pinned `merge_base`

No bulk data rides `args` — workflow agents gather their own diff context
from the checkout, and the workflow returns grouped findings with review
metadata.

## Present Review Board

Present the review board before drafting or posting anything. Use this order:

### 1. Heading

Format: `owner/repo#number — PR title`

Below the heading, include a one-line summary with section counts derived
from section array lengths, plus the reviewer list from
`reviewMeta.selectedReviewers` (full agent names): `N findings recommended,
M overlap existing threads, P discussion-worthy. Reviewers: code-reviewer,
pr-test-analyzer.` If `reviewMeta.lensSelection.source` is
`all-lenses-fallback`, add a line: the lens selector returned invalid
output, so every lens ran. Add a one-line shape summary from `summary`
(file count, additions/deletions, scale, notable areas — or that the shape
is unavailable); per-lens rationales live in
`reviewMeta.lensSelection.rationales` when the user asks.

Then show merge signals from the metadata and the pinned range:

- `mergeable` is false → `⚠ This PR has merge conflicts with <base.ref>.`
- `mergeable` is null → `Mergeability is still computing on GitHub.`
- `base_ahead_count` > 0 → `<base.ref> has moved <base_ahead_count> commits
  since this PR forked.`

If `reviewMeta.threadCollectionFailed` is true, warn: existing review threads
could not be collected, so overlap classification is unavailable and
recommended findings may duplicate existing comments.

If `reviewMeta.impactAssessment.incomplete` is true, warn: impact assessment
covered only `assessed` of `actionable` actionable findings, so some findings
show no impact line.

### 2. Recommended to post (full detail)

For each finding, include:

- stable id, location, lens, title, confidence
- claim
- evidence
- why it matters
- impact if unaddressed: from `unaddressedImpact` — the tier and consequence,
  e.g. `Impact if unaddressed: minor — <consequence>`. This comes from a
  skeptical assessor independent of the specialist that raised the finding,
  so it may honestly contradict the severity or the why-it-matters text —
  present the disagreement as-is rather than reconciling it. Omit the line
  when the finding carries no assessment.
- suggested fix or next step
- recommendation rationale: one sentence explaining why this finding is
  recommended for posting, synthesized from severity, confidence, and overlap
  status

### 3. Related to existing threads (full detail)

Same fields as recommended, plus existing review overlap rationale.

### 4. Discussion-worthy (full detail)

Same fields as recommended; rationale explains why not recommended to post.

### 5. Already covered (one-liner per finding)

One line per finding: `id — title (covered by thread on path:line)`.

### 6. Discarded (one-liner per finding)

One line per finding: `id — title (reason)`.

### 7. Positive observations

List positive observations when present.

## Ask What To Do Next

After presenting the board, propose a recommended action based on board state
using `AskUserQuestion` with contextual options.

### When recommended findings exist

Write a brief assessment of the recommended findings and any notable
overlaps. Name any recommended finding whose unaddressed impact was assessed
as negligible — those are the natural candidates to deselect. Then offer
options:

1. "Draft recommended findings" (first option — the recommended action)
2. "Draft all including overlap endorsements"
3. "I want to adjust the selection"
4. "Cancel"

### When only overlap or discussion findings exist

1. "Endorse overlap findings"
2. "Skip posting"
3. "I want to discuss specific findings"
4. "Cancel"

### When nothing is postable

1. "Leave an approving review"
2. "I spotted something"
3. "Done"

The user may type free-form text via Other (e.g., "Tell me more about F3").
Respond accordingly and loop back to updated options.

## Drafting And Posting

When the user chooses to draft, endorse, approve, or post, read
`${CLAUDE_SKILL_DIR}/references/posting.md` and follow it exactly. It
governs drafting style, line-anchor validity, the exact preview, explicit
approval, and the approved GitHub writes.
