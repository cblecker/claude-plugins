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
  - Bash(git diff --name-status *)
  - mcp__plugin_github_github__pull_request_read
  - mcp__plugin_github_github__pull_request_review_write
  - mcp__plugin_github_github__add_comment_to_pending_review
  - mcp__plugin_github_github__get_me
  - AskUserQuestion
---

# PR Review: $pr-url

## Constraints

All data processing must use only: git commands, jq, and MCP tools.

## Phase 1: Collect PR metadata

Parse `$pr-url` to extract owner, repo, and PR number from the GitHub URL
pattern `https://github.com/{owner}/{repo}/pull/{number}`.

### Step 1 — Get PR details and determine locality

1. Call `pull_request_read` with method `get` to get PR details. Extract:
   - `head.sha` (headSha)
   - `base.ref` (baseRef)
2. Run `git rev-parse HEAD` to get the local HEAD SHA. If it matches
   `head.sha`, set `isLocal` to true; otherwise false.
3. Run `git fetch origin <baseRef>` to ensure the merge-base is available
   locally for agents.

Note: `base.sha` from the API is the current tip of the base branch (it
updates as the base branch advances), not the merge-base. We pass
`baseRef` (the branch name) instead, and use three-dot syntax
(`origin/<baseRef>...HEAD`) which computes the merge-base implicitly —
matching what GitHub uses for the PR diff.

### Step 2 — Select review agents

1. Get the list of changed files with statuses:
   - If `isLocal` is true: run `git diff --name-status origin/<baseRef>...HEAD`
     (cheap — filenames only, no patches).
   - If `isLocal` is false: call `pull_request_read` with method `get_files`
     for the PR. Use only the filename and status from each entry.
2. `code-reviewer` always runs. For each optional agent, decide whether to
   include it based on the changed file list and the agent's role:

   | Agent | Role | Include when |
   |-------|------|-------------|
   | `silent-failure-hunter` | Audits error handling for silent failures, broad catches, swallowed errors | Changes touch code with error handling, try/catch, fallback logic, or result types |
   | `pr-test-analyzer` | Evaluates test coverage gaps for new/changed functionality | Changes include functional code that should have corresponding tests |
   | `comment-analyzer` | Verifies comment accuracy and flags misleading/stale documentation | Changes add or modify comments, docstrings, or documentation files |
   | `type-design-analyzer` | Reviews type invariants, encapsulation, and design in typed languages | Changes introduce or modify type definitions in typed languages (Go, TypeScript, Rust, Java, etc.) |

3. Use judgment — a PR that only renames a config key doesn't need a type
   design review even if it touches a `.go` file. A PR adding a new API
   endpoint with no tests warrants `pr-test-analyzer` even if no test files
   changed.

## Phase 2: Run review workflow

Invoke the Workflow tool with:

- `scriptPath`: `${CLAUDE_SKILL_DIR}/review-pr.js`
- `args`:
  - `owner`, `repo`, `pullNumber`, `headSha`, `baseRef`, `isLocal`
  - `agents`: array of selected agent names from Step 2

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
