---
name: review-pr
description: >-
  Conduct a comprehensive PR review and return an interactive review board
disable-model-invocation: true
arguments: [pr-url]
argument-hint: <github-pr-url>
allowed-tools:
  - Workflow
  - AskUserQuestion
  - Bash(git fetch origin refs/pull/*/merge)
  - Bash(git checkout --detach FETCH_HEAD)
  - Bash(git rev-parse *)
  - Bash(git diff *)
  - mcp__plugin_github_github__pull_request_read
  - mcp__plugin_github_github__pull_request_review_write
  - mcp__plugin_github_github__add_comment_to_pending_review
  - mcp__plugin_github_github__add_reply_to_pull_request_comment
  - mcp__plugin_golang_gopls__go_diagnostics
  - mcp__plugin_golang_gopls__go_file_context
  - mcp__plugin_golang_gopls__go_package_api
  - mcp__plugin_golang_gopls__go_search
  - mcp__plugin_golang_gopls__go_symbol_references
  - mcp__plugin_golang_gopls__go_vulncheck
  - mcp__plugin_golang_gopls__go_workspace
---

# PR Review: $pr-url

## Git Environment

- Repository root: !`git rev-parse --show-toplevel 2>/dev/null || echo __NOT_A_GIT_REPO__`
- Worktree state: !`git diff-index --quiet HEAD -- 2>/dev/null && echo __WORKTREE_CLEAN__ || echo __WORKTREE_DIRTY__`
- Origin URL: !`git remote get-url origin 2>/dev/null || echo __NO_ORIGIN_REMOTE__`

## Constraints

Use only `allowed-tools`. Do not generate ad-hoc processing scripts. Workflow
return values and MCP responses are structured JSON; read them directly. Bash is
limited to the git patterns in `allowed-tools` for preflight and diff steps
below.

The workflow and its agents are read-only — they must not call GitHub write tools.

GitHub write tools may be used only after an exact preview and explicit final
posting approval from the user.

## Parse PR URL

Parse `$pr-url` to extract owner, repo, and PR number from:

```text
https://github.com/{owner}/{repo}/pull/{number}
```

## Fetch PR Metadata

Call `pull_request_read` with method `get`. Extract and record:

- `headSha`: the current head commit SHA of the PR
- `changedFiles`: the number of changed files
- base repository clone URL (typically `https://github.com/{owner}/{repo}`)

## Local Git Preflight

Set up a verified local checkout of the PR merge result. If any check below
fails, record the reason as `fallbackReason`, skip remaining preflight, and
launch the workflow without `localGitManifest` or `fullDiff`.

### Check injected git environment

Read the three values from the Git Environment section above.

1. `__NOT_A_GIT_REPO__` → "not a git repository"
2. `__WORKTREE_DIRTY__` → "worktree has uncommitted changes"
3. `__NO_ORIGIN_REMOTE__` → "no origin remote"
4. Normalize origin URL and PR base URL to `{owner}/{repo}` (strip protocol,
   `.git` suffix; case-insensitive). Mismatch → "origin does not match PR base
   repository"

### Fetch merge ref

```bash
git fetch origin refs/pull/{number}/merge
```

Failure → "merge ref fetch failed".

### Checkout merge commit

```bash
git checkout --detach FETCH_HEAD
```

Do NOT auto-restore the original ref afterward.

### Verify merge parents

```bash
git rev-parse HEAD HEAD^1 HEAD^2
```

Output: line 1 = `mergeCommit`, line 2 = `baseSha`, line 3 = `headSha` (PR
head). If line 3 does not match the PR metadata `headSha`, record "HEAD^2 does
not match PR headSha". Do not trust local diff data on mismatch.

## Build Local Git Manifest

If all preflight checks passed, build the file manifest from local git.

### Collect file statuses

```bash
git diff --name-status -z HEAD^1 HEAD
```

Parse NUL-delimited output into `{path, status}` entries. Map `A`, `M`, `D`,
`R*`, `C*` to `added`, `modified`, `deleted`, `renamed`, `copied`. For renames
and copies, use the destination path.

### Collect line counts

```bash
git diff --numstat -z HEAD^1 HEAD
```

Parse NUL-delimited numstat and merge with the status list. For renames/copies
use destination path as key. Binary files show `-` for additions/deletions;
store as 0. Each entry has shape: `{path, status, additions, deletions}`.

The resulting array is the `localGitManifest`.

## Collect Full Diff (Optional)

If the manifest was built, collect the full merge diff:

```bash
git diff --no-ext-diff --no-textconv HEAD^1 HEAD
```

Store as `fullDiff` if 200,000 characters or fewer; otherwise omit.

## Launch Analysis Workflow

Invoke the Workflow tool with:

- `scriptPath`: `${CLAUDE_SKILL_DIR}/review-pr.js`
- `args`: `owner`, `repo`, `pullNumber`, `localGitManifest` (omit if preflight
  failed), `fullDiff` (omit if not collected), and `sources`:
  - `mergeCommit`, `baseSha`, `headSha` (empty strings if preflight failed)
  - `fullDiffIncluded`: whether fullDiff is included
  - `fallbackReason`: reason preflight failed (or empty string)

The workflow collects PR metadata via MCP, runs specialist analysis, fetches
review threads, and returns grouped findings with review metadata.

## Present Review Board

Present the review board before drafting or posting anything. Use this order:

### 1. Heading

Format: `owner/repo#number — PR title`

Below the heading, include a one-line summary with section counts derived from
section array lengths:

```text
N findings recommended, M overlap existing threads, P discussion-worthy.
Reviewers: code-reviewer, pr-test-analyzer, silent-failure-hunter.
```

The reviewer list comes from `reviewMeta.selectedReviewers` which stores full
agent names.

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

Write a brief assessment of the recommended findings and any notable overlaps,
then offer options:

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

Draft `relatedToExisting` findings as thread replies: acknowledge the original
comment, add the new perspective, and avoid restating the concern.

### Line comments vs review body

Prefer line comments for findings with a concrete changed-file location. Put
findings without a valid line location in the review body.

### Review event

Choose the proposed review event from the selected findings:

- `REQUEST_CHANGES` only when at least one selected finding is a serious
  correctness or blocking concern.
- `COMMENT` for non-blocking feedback, suggestions, endorsements, or discussion.
- `APPROVE` when the user selected "Leave an approving review" from the
  nothing-postable menu and no findings are being posted.

## Translate Line Numbers for Posting

Skip this section if MCP fallback was used (no local checkout) — findings
already use PR HEAD line numbers.

Findings use merge-result line numbers. GitHub requires PR HEAD (`HEAD^2`)
line numbers. Translate before posting.

### Quick check

```bash
git diff --name-only HEAD^2 HEAD
```

No output → lines are identical, skip translation.

### Per-file translation

For each finding on a file listed above:

1. Run `git diff HEAD^2 HEAD -- <path>`.
2. If the finding's line falls on a `+`-only line (no PR HEAD equivalent),
   move the finding to the review body.
3. If the line falls within a hunk on a context line, find the PR HEAD line
   by counting context and `-` lines from the hunk's PR HEAD start (`a` in
   `@@ -a,b +c,d @@`).
4. If the line falls between hunks, accumulate the offset from preceding
   hunks: `offset += (b - d)` per `@@ -a,b +c,d @@`.
   `PR_HEAD_line = merge_line + offset`.
5. Validate the translated line falls within a PR diff hunk (from
   `pull_request_read get_files`). If not, move to review body.

Files absent from the diff output have identical line numbers — use as-is.

## Preview And Confirm

Before posting, show an exact preview.

For each finding being posted as a new line comment, show:

- finding id, path, line, and body

For each overlap finding being posted as a thread reply, show:

- finding id, "Reply to thread on path:line", and body

For review body text (non-line findings), show the review body.

Show the proposed review event: `COMMENT`, `REQUEST_CHANGES`, or `APPROVE`.

After the preview, ask for explicit approval with `AskUserQuestion`:

1. "Post this review"
2. "Edit the draft"
3. "Add or remove findings"
4. "Cancel"

Accept approval only when the user selects "Post this review" or clearly
confirms posting. If the user requests edits or removals, update the preview and
ask for approval again.

## Post Approved Review

Use GitHub write tools only in this final approved step.

### Posting new line comments

If the approved preview has new line comments:

1. Create a pending review with
   `mcp__plugin_github_github__pull_request_review_write`.
2. Add approved line comments with
   `mcp__plugin_github_github__add_comment_to_pending_review`.
3. Submit the pending review with
   `mcp__plugin_github_github__pull_request_review_write` using the approved
   event and review body.

### Posting thread replies for overlap findings

Post overlapping findings as replies using
`add_reply_to_pull_request_comment` with the numeric `commentId` and
`pullNumber`. If `commentId` is missing or invalid, post as a new line comment
via the pending review flow instead. Thread replies are independent of the
pending review submission.

### Review body only

If the approved preview has only review-body text, submit the review body with
`mcp__plugin_github_github__pull_request_review_write` using the approved event.

### Invalid locations

If a line comment cannot be added because the location is invalid for the PR
diff, move that text into the review body, show the revised preview, and ask for
approval again before posting.
