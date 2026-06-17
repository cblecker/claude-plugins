---
name: review-pr
description: >-
  Conduct a comprehensive PR review with scored findings and post
  as line-level review comments
disable-model-invocation: true
arguments: [pr-url]
argument-hint: <github-pr-url>
allowed-tools:
  - Workflow
  - Bash(git rev-parse *)
  - Bash(git fetch *)
  - Bash(git diff *)
  - Bash(jq *)
  - mcp__plugin_github_github__pull_request_read
  - mcp__plugin_github_github__pull_request_review_write
  - mcp__plugin_github_github__add_comment_to_pending_review
  - mcp__plugin_github_github__get_me
  - AskUserQuestion
---

# PR Review: $pr-url

## Phase 1: Collect PR metadata

Parse `$pr-url` to extract owner, repo, and PR number from the GitHub URL
pattern `https://github.com/{owner}/{repo}/pull/{number}`.

### Step 1 — Get PR details and determine locality

1. Call `pull_request_read` with method `get` to get PR details. Extract:
   - `head.sha` (the head commit SHA)
   - `base.ref` (the target branch name, e.g. `main`)
2. Run `git rev-parse HEAD` to get the local HEAD SHA.
3. If local HEAD matches `head.sha`, set `isLocal` to true; otherwise false.

### Step 2 — Discover changed filenames

Get a flat list of changed filenames (no patch content yet).

**When isLocal:**

```
git fetch origin <base_ref>
git diff --name-only origin/<base_ref>...HEAD
```

The `git fetch` ensures the merge-base is current and matches what GitHub
computes for the PR.

**When not isLocal:**

Call `pull_request_read` with method `get_files`, `perPage: 100`, and
paginate through all pages. Each page response may exceed token limits and
get saved to disk — that is expected. Extract filenames from each saved
response file using jq:

```
jq '[.[].filename]' <saved-response-file>
```

Do NOT use python or other interpreters for JSON extraction — use jq only.

Concatenate all filenames across pages into a single list.

### Step 3 — Categorize files

Partition the filename list into three categories:

- **vendor**: paths starting with `vendor/`
- **generated**: filenames matching any of `zz_generated*`, `*_generated.go`,
  `*.pb.go`, `*_string.go`, `bindata.go`, or ending in `.sum`
- **reviewable**: everything else

Build an `excludedFileSummary` string describing what was filtered, e.g.:
`"305 vendor/ files excluded, 14 generated files excluded"`.

If the reviewable list is empty, skip Phases 2–4 and inform the user that
all changed files are vendor dependencies or generated code with nothing to
review.

### Step 4 — Fetch patches for reviewable files

Get authoritative merge-base patches for the reviewable files only.

**When isLocal:**

Run a single git diff for all reviewable files at once:

```
git diff origin/<base_ref>...HEAD -- <file1> <file2> <file3> ...
```

This produces a unified diff relative to the merge-base — the same
comparison GitHub uses for the PR. Parse the output into per-file objects
with `{ filename, patch, status }` shape. Each file's patch starts with
`diff --git a/<path> b/<path>` and runs until the next such header or EOF.
Infer status from the diff header: `new file mode` → added,
`deleted file mode` → removed, `rename from` → renamed, otherwise →
modified.

**When not isLocal:**

Re-read the saved `get_files` response pages from Step 2. For each page,
use jq to extract `{ filename, patch, status }` objects only for files in
the reviewable set:

```
jq '[.[] | select(.filename == "file1" or .filename == "file2" or ...) | {filename, patch, status}]' <saved-response-file>
```

For large reviewable sets, construct the `select()` condition dynamically by
joining each filename with ` or .filename == ` operators. If the resulting
jq command exceeds shell argument limits, process pages one at a time and
concatenate the results.

## Phase 2: Run review workflow

Invoke the Workflow tool with:

- `scriptPath`: `${CLAUDE_SKILL_DIR}/review-pr.js`
- `args`:
  - `owner`, `repo`, `pullNumber`, `headSha`, `isLocal`
  - `changedFiles`: array of `{ filename, patch, status }` objects (reviewable
    files only, with authoritative merge-base patches; status is one of
    added/modified/removed/renamed)
  - `excludedFileSummary`: string from Step 3

Wait for the workflow to complete — it returns
`{ findings, positiveObservations }`

## Phase 3: Post-process findings

1. Fetch existing review comments via `pull_request_read` with method
   `get_review_comments` — drop findings that duplicate existing comments
   (match by file + approximate line + similar description)
2. Identify the authenticated user via `get_me`, then fetch previous reviews by
   this user via `pull_request_read` with method `get_reviews` — check if
   previous review comments were addressed
3. Present deduplicated findings to the user via AskUserQuestion:
   - Group by severity: critical > important > suggestion
   - Include positive observations
   - Ask which findings to include in the review

## Phase 4: Post review (after user approval)

1. Create a pending review: `pull_request_review_write` with method `create`
2. For each approved finding with a file and line number:
   - Call `add_comment_to_pending_review` with the file, line, and a
     natural-language comment written as if by the user
   - Use `subjectType: "LINE"` and `side: "RIGHT"`
3. Write the review body as a brief summary of the review. Include any approved
   findings that lack a file or line number as inline items in the body.
4. Submit: `pull_request_review_write` with method `submit_pending`
   - Event: `REQUEST_CHANGES` if any critical findings were approved
   - Event: `COMMENT` otherwise
