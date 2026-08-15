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
  - Bash(git rev-parse *)
  - Bash(git status *)
  - Bash(git config --get-regexp *)
  - Bash(git remote get-url origin)
  - Bash(git fetch origin *)
  - Bash(git merge-base *)
  - Bash(git rev-list *)
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

## Constraints

Use only `allowed-tools`. Do not generate ad-hoc processing scripts. Workflow
return values and MCP responses are structured JSON; read them directly. Bash
is limited to the read-only git commands used below plus one `git fetch` of
the base branch. The workflow and its agents are read-only. GitHub write
tools may be used only after an exact preview and explicit final posting
approval from the user. If plan mode is active, call `ExitPlanMode` before
proceeding.

## Resolve The PR

Determine which PR this checkout belongs to. The next section verifies the
candidate's head SHA, so resolution only has to produce the right candidate,
not prove it. Record the local head SHA (`git rev-parse HEAD`) and parse
`{owner}/{repo}` from `git remote get-url origin` (the host must be
github.com), then use the first route that yields a candidate:

1. **Branch config** — on a named branch, run
   `git config --get-regexp '^branch\.'` (a fixed command, no name
   interpolation) and read the current branch's `merge` key.
   `gh pr checkout` writes `refs/pull/N/head` there: N is the PR number,
   with zero network calls.
2. **Head filter** — on a named branch without a pull ref, call
   `list_pull_requests` with state `open` and head `{owner}:{branch}` — an
   exact server-side filter.
3. **SHA search** — otherwise: `search_pull_requests` with query
   `repo:{owner}/{repo} is:pr is:open {headSha}`, confirming each
   candidate's head SHA via its metadata. If none is confirmed (the index
   lags recent pushes and matches PRs that merely mention the SHA), scan
   `list_pull_requests` state `open` to the last page for `head.sha` equal
   to the local HEAD.

Exactly one open PR matches: proceed. Zero or several: stop with an honest
error naming the SHA and repository checked and the fix (check out the PR
head, push commits, or pick one PR).

## Fetch PR Metadata

Call `pull_request_read` with method `get`. Record: title, body, author,
state, `base.ref`, the base repository full name, head SHA, and
`mergeable` / `mergeable_state`.

Verify `git rev-parse HEAD` equals the PR's head SHA. On mismatch, stop with
an honest error and name the fix: unpushed local commits need a push first,
and a stale checkout after a new push needs the new head fetched and checked
out.

Run `git status --porcelain`; if the working tree is dirty, warn but do not
block (file reads see uncommitted edits; the diff itself is tree-to-tree).

## Pin The Review Range

Verify the `origin` URL points at the PR's base repository from the metadata
(a fork clone points at the fork and would compute a wrong merge base); stop
honestly on mismatch. `base.ref` is remote data: stop unless it matches
`^[A-Za-z0-9._/-]+$`.

Fetch the base branch unconditionally (the skill's only network git command),
so the base is current at review time, then pin the range and measure base
movement against `FETCH_HEAD` — exact regardless of the clone's refspec
configuration:

```bash
git fetch origin <base.ref>
git merge-base FETCH_HEAD HEAD                 # record as merge_base
git rev-list --count <merge_base>..FETCH_HEAD  # record as base_ahead_count
```

## Launch Analysis Workflow

Invoke the Workflow tool with:

- `scriptPath`: `${CLAUDE_SKILL_DIR}/review-pr.js`
- `args`:
  - `pr`: `{ owner, repo, number, title, body, author, state, baseRef,
    headSha }` from the metadata
  - `checkoutPath`: output of `git rev-parse --show-toplevel`
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
output, so every lens ran.

Then show merge signals from the metadata and the pinned range:

- `mergeable` is false → `⚠ This PR has merge conflicts with <base.ref>.`
- `mergeable` is null → `Mergeability is still computing on GitHub.`
- `base_ahead_count` > 0 → `<base.ref> has moved <base_ahead_count> commits
  since this PR forked.`

If `reviewMeta.threadCollectionFailed` is true, warn: existing review threads
could not be collected, so overlap classification is unavailable and
recommended findings may duplicate existing comments.

### 2. Recommended to post (full detail)

For each finding, include:

- stable id, location, lens, title, confidence
- claim
- evidence
- why it matters
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
overlaps, then offer options:

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

## Draft Selected Comments

Draft comments only in the conversation. Drafts should:

- sound like the user wrote them
- be concise and actionable
- avoid boilerplate, severity labels, and AI markers
- include enough context for the PR author to act
- avoid duplicating comments already covered elsewhere
- distinguish blocking concerns from optional suggestions

### Overlap findings

Draft `relatedToExisting` findings as thread replies: acknowledge the
original comment, add the new perspective, and avoid restating the concern.

### Line comments vs review body

Prefer line comments for findings with a concrete changed-file location.
Findings anchor to PR head line numbers from birth — specialists review the
head checkout, so no translation is needed. A finding whose line is not part
of the PR diff cannot carry a line comment: put it in the review body
instead.

### Review event

Choose the proposed review event from the selected findings:

- `REQUEST_CHANGES` only when at least one selected finding is a serious
  correctness or blocking concern.
- `COMMENT` for non-blocking feedback, suggestions, endorsements, or
  discussion.
- `APPROVE` when the user selected "Leave an approving review" from the
  nothing-postable menu and no findings are being posted.

## Preview And Confirm

Before posting, show an exact preview.

For each finding being posted as a new line comment, show:

- finding id, path, line, and body

For each overlap finding being posted as a thread reply, show:

- finding id, "Reply to thread on path:line", and body
- if `isResolved` is true: `⚠ Target thread is resolved — reply will stay
  collapsed and the PR author may not see it.`
- if `isResolved` is absent (resolution state not exposed by the read tools):
  `(thread resolution state unknown — a resolved thread keeps this reply
  collapsed)`
- if there is no `commentId`, do not silently fall through to a new comment:
  show `⚠ No reply target available — posting would create a new line comment
  that may duplicate the existing thread.` and let the user choose line
  comment, review body, or skip

For review body text (non-line findings), show the review body.

Show the proposed review event: `COMMENT`, `REQUEST_CHANGES`, or `APPROVE`.

After the preview, ask for explicit approval with `AskUserQuestion`. Use the
`preview` field on each option so the reviewer can attach free-text notes to
their selection (e.g., specifying exactly what to edit):

1. "Post this review"
2. "Edit findings" — covers editing drafts, adding, or removing findings
3. "Convert resolved-thread replies to new line comments" — include this
   option only when at least one overlap finding targets a resolved thread
4. "Cancel"

Accept approval only when the user selects "Post this review" or clearly
confirms posting. If the user requests edits or removals, update the preview
and ask for approval again.

## Post Approved Review

Before the first write, re-fetch metadata once with `pull_request_read`
`get`: if the head SHA changed since analysis, abort honestly — the review
no longer describes the PR — and offer to re-run on the new head.

Use GitHub write tools only in this final approved step.

### Posting new line comments

If the approved preview has new line comments:

1. Create a pending review with `pull_request_review_write`, passing the
   reviewed head SHA as `commitID` so comment anchors are pinned to the
   reviewed commit.
2. Add approved line comments with `add_comment_to_pending_review`.
3. Submit the pending review with `pull_request_review_write` using the
   approved event and review body.

### Posting thread replies for overlap findings

Post overlapping findings as replies using
`add_reply_to_pull_request_comment` with the numeric `commentId` and
`pullNumber`. If the reply API rejects the target as invalid, do not silently
change the posting location: convert the finding to a proposed new line
comment, show the revised preview, and ask for approval again — same as
invalid line locations below. Thread replies are independent of the pending
review submission.

### Review body only

If the approved preview has only review-body text, submit it with
`pull_request_review_write` using the approved event and the reviewed head
SHA as `commitID`.

### Invalid locations

If a line comment cannot be added because the location is invalid for the PR
diff, move that text into the review body, show the revised preview, and ask
for approval again before posting.
