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
---

# PR Review: $pr-url

## Git Environment

- Repository root: !`git rev-parse --show-toplevel 2>/dev/null || echo __NOT_A_GIT_REPO__`
- Worktree state: !`git diff-index --quiet HEAD -- 2>/dev/null && echo __WORKTREE_CLEAN__ || echo __WORKTREE_DIRTY__`
- Origin URL: !`git remote get-url origin 2>/dev/null || echo __NO_ORIGIN_REMOTE__`

## Constraints

Use only the tools listed in `allowed-tools`. Do not generate ad-hoc scripts to
process GitHub data. Workflow return values and MCP responses are structured
JSON; read them directly.

Bash access is intentionally limited to the `git fetch`, `git checkout`,
`git rev-parse *`, and `git diff *` patterns listed in `allowed-tools`. Use them
only for the exact local-git preflight and diff commands below. The three git
environment checks above were injected during skill preprocessing and do not
require Bash tool calls.

The bundled workflow and workflow-spawned agents are analysis-only. They must
use GitHub read tools only and must not draft pending reviews, add comments,
submit reviews, resolve threads, or call GitHub write tools.

The skill conversation may draft comment text after the user selects findings.
GitHub write tools may be used only after an exact preview and explicit final
posting approval from the user.

## Parse PR URL

Parse `$pr-url` to extract owner, repo, and PR number from:

```text
https://github.com/{owner}/{repo}/pull/{number}
```

## Fetch PR Metadata

Before local git preflight, fetch PR metadata to obtain the head SHA and base
repository information. Call `mcp__plugin_github_github__pull_request_read` with
method `get` for the parsed owner, repo, and pull number.

Extract and record:

- `headSha`: the current head commit SHA of the PR
- `changedFiles`: the number of changed files
- base repository clone URL (typically `https://github.com/{owner}/{repo}`)

These values are needed to verify the local git checkout.

## Local Git Preflight

Attempt to set up a verified local git checkout of the PR merge result. If any
check fails, record the failure reason, skip to the Launch Analysis Workflow
section, and pass no `localGitManifest` or `fullDiff` in the workflow args. The
workflow will fall back to MCP-based file collection.

### Check injected git environment

Read the three values from the Git Environment section above.

1. If repository root is `__NOT_A_GIT_REPO__`, record fallback reason "not a
   git repository" and skip to workflow launch.
2. If worktree state is `__WORKTREE_DIRTY__`, record fallback reason "worktree
   has uncommitted changes" and skip to workflow launch.
3. If origin URL is `__NO_ORIGIN_REMOTE__`, record fallback reason "no origin
   remote" and skip to workflow launch.
4. Compare the origin URL to the PR base repository URL. The origin URL may use
   HTTPS (`https://github.com/{owner}/{repo}.git` or
   `https://github.com/{owner}/{repo}`) or SSH
   (`git@github.com:{owner}/{repo}.git`). Normalize both to `{owner}/{repo}`
   for comparison (case-insensitive). If they do not match, record fallback
   reason "origin does not match PR base repository" and skip to workflow
   launch.

### Fetch merge ref

Run this exact command, substituting the PR number:

```bash
git fetch origin refs/pull/{number}/merge
```

If this fails, the merge ref may not exist (e.g., the PR has merge conflicts or
is closed). Record fallback reason "merge ref fetch failed" and skip to workflow
launch.

### Checkout merge commit

Run this exact command:

```bash
git checkout --detach FETCH_HEAD
```

This checks out the merge result as a detached HEAD. Do NOT auto-restore the
original ref afterward.

### Verify merge parents

Run this exact command (all three refs in one call):

```bash
git rev-parse HEAD HEAD^1 HEAD^2
```

This outputs three lines:

- first line = `mergeCommit` (the merge commit SHA)
- second line = `baseSha` (the base branch parent)
- third line = `headSha` (the PR head parent)

Verify that the third line matches the `headSha` from the PR metadata fetched
earlier. If they do not match, record fallback reason "HEAD^2 does not match PR
headSha" and skip to workflow launch. Do NOT trust local diff data when the
merge parents do not match.

## Build Local Git Manifest

If all preflight checks passed, build the file manifest from local git.

### Collect file statuses

Run this exact command:

```bash
git diff --name-status -z HEAD^1 HEAD
```

Parse the NUL-delimited output into `{path, status}` entries. Map `A`, `M`, `D`,
`R*`, and `C*` to `added`, `modified`, `deleted`, `renamed`, and `copied`. For
renames and copies, use the destination path.

### Collect line counts

Run this exact command:

```bash
git diff --numstat -z HEAD^1 HEAD
```

Parse the NUL-delimited numstat output and merge it with the status list. Normal
files have additions, deletions, and path. Rename/copy entries include source
and destination paths; use the destination path as the merge key. Binary files
show `-` for additions and deletions; store both as 0. Each manifest entry must
have this shape:

```json
{
  "path": "pkg/auth/session.go",
  "status": "modified",
  "additions": 42,
  "deletions": 12
}
```

The resulting array is the `localGitManifest`.

## Collect Full Diff (Optional)

If the local git manifest was built successfully, attempt to collect the full
merge diff.

Run this exact command:

```bash
git diff --no-ext-diff --no-textconv HEAD^1 HEAD
```

If the output is 200,000 characters or fewer, store it as the `fullDiff` string
to pass to the workflow. If the output exceeds 200,000 characters, do not pass
`fullDiff`.

## Launch Analysis Workflow

Invoke the Workflow tool with:

- `scriptPath`: `${CLAUDE_SKILL_DIR}/review-pr.js`
- `args`:
  - `owner`
  - `repo`
  - `pullNumber`
  - `localGitManifest` (array of manifest entries, or omit if preflight failed)
  - `fullDiff` (string, or omit if not collected or preflight failed)
  - `sources` (object with preflight metadata; the workflow derives
    `manifestSource` and `patchSource` from the presence of `localGitManifest`
    and `fullDiff`):
    - `mergeCommit`: the merge commit SHA (or empty string)
    - `baseSha`: the base parent SHA (or empty string)
    - `headSha`: the head parent SHA (or empty string)
    - `fullDiffIncluded`: true if fullDiff is being passed
    - `fallbackReason`: reason preflight failed (or empty string)

If preflight failed, omit `localGitManifest` and `fullDiff`, but still pass
`sources` with empty `mergeCommit`, `baseSha`, and `headSha`,
`fullDiffIncluded: false`, and the preserved `fallbackReason` so the workflow
records why local git was not used.

The workflow owns PR metadata collection (via MCP), reviewer selection,
specialist analysis, and review-board synthesis. It also fetches review threads
(always from MCP).

The workflow returns grouped findings, positive observations, PR metadata,
summary, and review metadata.

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

For each finding, include the same fields as recommended findings, plus:

- existing review overlap rationale
- recommendation rationale explaining why this is related to an existing thread
  rather than standalone

### 4. Discussion-worthy (full detail)

For each finding, include the same fields as recommended findings, with the
recommendation rationale explaining why this is not recommended to post.

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

### Exploratory actions

There are no dedicated commands. The user can type anything via the Other field,
such as "Tell me more about F3" or "I disagree with F1". Interpret natural
language flexibly, respond accordingly, and loop back to present updated options.

## Draft Selected Comments

Draft comments only in the conversation. Drafts should:

- sound like the user wrote them
- be concise and actionable
- avoid boilerplate, severity labels, and AI markers
- include enough context for the PR author to act
- avoid duplicating comments already covered elsewhere
- distinguish blocking concerns from optional suggestions

### Drafting for overlap findings (relatedToExisting)

For findings in `relatedToExisting`, draft as thread replies rather than
standalone comments. The draft should:

- acknowledge the original comment and add the new perspective
- avoid restating the concern from scratch
- read naturally as a reply in the existing conversation

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

For findings with `existingReviewOverlap.status === 'overlaps'` and a valid
numeric `existingReviewOverlap.commentId`, post as a reply to the existing
thread using `mcp__plugin_github_github__add_reply_to_pull_request_comment`
with the `commentId` and `pullNumber`.

If the `commentId` is missing or invalid, fall back to posting as a new line
comment via the pending review flow.

Thread replies are posted independently of the pending review flow — they do
not need to be part of the pending review submission.

### Review body only

If the approved preview has only review-body text, submit the review body with
`mcp__plugin_github_github__pull_request_review_write` using the approved event.

### Invalid locations

If a line comment cannot be added because the location is invalid for the PR
diff, move that text into the review body, show the revised preview, and ask for
approval again before posting.
