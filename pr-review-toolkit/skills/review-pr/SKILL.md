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
  - mcp__plugin_github_github__pull_request_read
  - mcp__plugin_github_github__pull_request_review_write
  - mcp__plugin_github_github__add_comment_to_pending_review
  - mcp__plugin_github_github__get_me
  - AskUserQuestion
---

# PR Review: $pr-url

## Phase 1: Collect PR metadata

1. Parse `$pr-url` to extract owner, repo, and PR number from the GitHub URL
   pattern `https://github.com/{owner}/{repo}/pull/{number}`
2. Call `pull_request_read` with method `get` to get PR details -- extract the
   head commit SHA
3. Call `pull_request_read` with method `get_files` to get the list of changed
   file paths
4. Run `git rev-parse HEAD` to get the local HEAD SHA
5. If local HEAD matches the PR head SHA, set isLocal to true; otherwise false

## Phase 2: Run review workflow

Invoke the Workflow tool with:

- `scriptPath`: `${CLAUDE_SKILL_DIR}/review-pr.js`
- `args`: `{ owner, repo, pullNumber, headSha, changedFiles, isLocal }` where
  changedFiles is an array of filename strings

Wait for the workflow to complete -- it returns
`{ findings, positiveObservations }`

## Phase 3: Post-process findings

1. Fetch existing review comments via `pull_request_read` with method
   `get_review_comments` -- drop findings that duplicate existing comments
   (match by file + approximate line + similar description)
2. Identify the authenticated user via `get_me`, then fetch previous reviews by
   this user via `pull_request_read` with method `get_reviews` -- check if
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
