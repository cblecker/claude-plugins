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

The workflow returns grouped findings, positive observations, an action plan,
coverage summary, PR metadata, summary, and review metadata.

## Present Review Board

Present the review board before drafting or posting anything. Keep it concise,
but do not hide important groups.

Use this order:

1. Review heading: `owner/repo#number` and PR title when available.
2. Coverage summary:
   - `coverageSummary.scope`
   - `coverageSummary.largePrNotes`, if present
   - selected reviewers and file/thread counts from `reviewMeta`
3. Action plan:
   - critical
   - important
   - suggestions
   - recommended next action
4. Findings grouped by outcome:
   - recommended to post
   - possible plus-ones
   - partial overlaps
   - worth discussing, not posting
   - already covered
   - discarded or weak findings, summarized if long
5. Positive observations.

For each finding shown in detail, include:

- stable id
- location
- lens
- title
- confidence
- claim
- evidence
- why it matters
- suggested fix or next step
- existing review overlap rationale when present

## Ask What To Do Next

After presenting the board, ask with `AskUserQuestion`:

```text
What should we do next? You can reply with commands like "draft recommended",
"draft F1 F3", "plus-one F2", "explain F4", "challenge F5", "show covered",
"skip F6", "post selected", or "cancel".
```

Use a free-text response, not option buttons. Interpret natural language
flexibly, but preserve the review board ids as the stable selection handles.

Support these actions:

- `draft recommended`: draft all `recommendedToPost` findings.
- `draft F1 F3`: draft selected findings.
- `plus-one F2`: draft a concise endorsement for an overlap finding.
- `skip F4`: mark a finding as intentionally omitted in the conversation.
- `explain F5`: explain the evidence, uncertainty, and tradeoffs.
- `challenge F6`: reassess the finding using the board evidence and state any
  uncertainty plainly.
- `show covered`: show `alreadyCovered` and relevant overlap rationale.
- `cancel`: stop without drafting or posting.
- `post selected`: only continue if there is already an approved preview;
  otherwise draft and preview first.

## Draft Selected Comments

Draft comments only in the conversation. Drafts should:

- sound like the user wrote them
- be concise and actionable
- avoid boilerplate, severity labels, and AI markers
- include enough context for the PR author to act
- avoid duplicating comments already covered elsewhere
- distinguish blocking concerns from optional suggestions

For possible plus-ones and partial overlaps, make the overlap explicit. Draft a
plus-one only when the finding's `existingReviewOverlap` indicates that an
endorsement or additional detail is useful.

Prefer line comments for findings with a concrete changed-file location. Put
findings without a valid line location in the review body.

Choose the proposed review event from the selected findings:

- `REQUEST_CHANGES` only when at least one selected finding is a serious
  correctness or blocking concern.
- `COMMENT` for non-blocking feedback, suggestions, plus-ones, or discussion.

## Preview And Confirm

Before posting, show an exact preview:

- each line comment with finding id, path, line, and body
- review body text for non-line findings
- proposed review event: `COMMENT` or `REQUEST_CHANGES`
- any selected findings intentionally omitted from posting

Ask for explicit final approval with `AskUserQuestion`. Accept approval only
when the user clearly confirms posting the preview, such as "post this",
"approved", or "submit". If the user requests edits or removals, update the
preview and ask for approval again.

## Post Approved Review

Use GitHub write tools only in this final approved step.

If the approved preview has line comments:

1. Create a pending review with
   `mcp__plugin_github_github__pull_request_review_write`.
2. Add approved line comments with
   `mcp__plugin_github_github__add_comment_to_pending_review`.
3. Submit the pending review with
   `mcp__plugin_github_github__pull_request_review_write` using the approved
   event and review body.

If the approved preview has only review-body text, submit the review body with
`mcp__plugin_github_github__pull_request_review_write` using the approved event.

If a line comment cannot be added because the location is invalid for the PR
diff, move that text into the review body, show the revised preview, and ask for
approval again before posting.
