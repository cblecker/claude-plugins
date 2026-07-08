# PR Review Toolkit

Reimplementation of Anthropic's
[pr-review-toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit)
as a single Workflow-based skill. The workflow collects shared PR context,
runs specialist reviewers, and returns an interactive review board for the
human reviewer.

## Skills

### review-pr

```text
/pr-review-toolkit:review-pr <github-pr-url>
```

Conduct a comprehensive PR review and return an interactive review board.
See [Review Flow](#review-flow) below.

### address-pr-feedback

```text
/pr-review-toolkit:address-pr-feedback [--interactive]
```

Systematically collect, analyze, score, and address pull request review
feedback from the current branch's PR. After implementing changes, drafts
reply comments and posts them to GitHub with per-reply user approval.

By default, the skill auto-detects the open PR for the current branch and
fetches all review comments via GitHub MCP. Use `--interactive` to manually
paste feedback items instead.

**Flow:** branch validation &rarr; feedback collection &rarr; parallel
analysis and scoring (Sonnet + Haiku agents) &rarr; per-item action
confirmation &rarr; plan generation &rarr; implementation &rarr; reply
posting.

## Review Flow

The skill parses a GitHub PR URL and launches the bundled workflow. The skill
first attempts to set up a verified local git checkout of the PR merge result for
efficient diff collection. If local git is unavailable or verification fails, it
falls back to GitHub MCP-based file collection.

### Local Git Diff Provider (Preferred)

When the current directory is a git repository with a clean worktree and
`origin` matches the PR base repository, the skill:

1. Fetches GitHub's `refs/pull/N/merge` synthetic merge ref from `origin`
2. Checks out the merge result as a detached HEAD
3. Verifies the merge commit's second parent (`HEAD^2`) matches the PR's
   `headSha` from GitHub metadata
4. Builds a compact file manifest from `git diff --name-status` and
   `git diff --numstat` (NUL-delimited for safe parsing of special characters)
5. Optionally collects the full merge diff when it fits within a 200K character
   cap

The local manifest and optional full diff are passed to the workflow via `args`.
Specialist agents can also use Read and Grep on the merged checkout to inspect
files in their merged state.

The skill does NOT auto-restore the original git ref after checkout. The merged
checkout state keeps the Read tool useful for workflow subagents. Running in a
dedicated worktree is recommended.

### MCP Fallback

When local git is unavailable, the workflow collects changed files via GitHub MCP
`get_files` with pagination and recovery retries, as in previous versions.

Fallback reasons are recorded in `reviewMeta.sources.fallbackReason` and include:
not a git repository, dirty worktree, origin mismatch, merge ref fetch failure,
or merge parent mismatch.

### Workflow

The workflow:

- collects PR metadata and review threads through GitHub MCP read tools
- uses the local git manifest when provided, or falls back to MCP file
  collection
- selects relevant reviewer lenses from the manifest
- passes the full merge diff to specialists when available, or instructs them
  to use Read/Grep on the merged checkout
- asks specialists for evidence-rich candidate findings
- synthesizes findings into a review board grouped by posting recommendation,
  existing-review overlap, and discussion value

The workflow does not draft or post comments. Drafting happens in the skill
conversation after the user selects findings. Posting requires an exact preview
and explicit final approval.

The control flow is:

```text
skill command
  |-- preflight: verify local git, checkout merge ref, build manifest
  |-- fallback: skip local git if any check fails
  v
Workflow(review-pr.js) -> workflow agent() calls
  collection agents -> pr-review-github-collector -> GitHub MCP reads (metadata, threads)
  specialist agents -> pr-review-analysis-readonly -> read-only repo/MCP inspection
```

The root skill handles local git checkout and manifest building with scoped Bash
commands. The workflow script owns MCP collection (when needed), pagination,
retries, validation, and merging. Spawned collection agents only perform focused
GitHub reads and return structured output. Specialist agents may inspect
repository files and use available read-only MCP tools to verify findings.

## Review Agents

| Agent | When it runs | What it does |
|-------|-------------|--------------|
| code-reviewer | Always | Reviews code for bugs, style, and guideline adherence (runs on Opus) |
| silent-failure-hunter | Changes touch error handling, try/catch, or fallback logic | Identifies silent failures and inadequate error handling |
| pr-test-analyzer | Functional code that should have corresponding tests | Analyzes test coverage completeness |
| comment-analyzer | Changes add or modify comments, docstrings, or docs | Checks comment accuracy and maintainability |
| type-design-analyzer | Changes introduce or modify type definitions in typed languages | Evaluates type design and invariant quality |
| security-reviewer | Changes touch auth, crypto, tokens, credentials, or security-related code | Reviews for security vulnerabilities and unsafe patterns |
| api-compat-reviewer | Changes touch public APIs, exports, or client-facing interfaces | Checks API compatibility and breaking changes |
| concurrency-reviewer | Changes touch mutexes, locks, channels, goroutines, or parallel code | Reviews concurrency patterns for races and deadlocks |

Agent selection is liberal: when in doubt, the agent runs. All agents execute in
parallel within a single workflow from the collected PR manifest and thread
context.

## Review Board

The workflow returns a review board grouped by outcome:

- `recommendedToPost` — high-signal findings that look postable by a human
  reviewer and are not already covered
- `relatedToExisting` — findings that overlap or endorse existing review threads
- `discussionOnly` — useful reviewer notes that should not be posted yet
- `alreadyCovered` — findings fully covered by existing human or bot review
  threads
- `discarded` — weak, duplicate, low-confidence, or non-actionable findings

Each finding preserves the specialist's claim, evidence, reasoning, suggested
fix, confidence, source lens, and existing-review overlap rationale. The board
also includes positive observations, PR metadata, and review metadata.

## Interaction And Posting

After the board is presented, the user can ask to draft recommended findings,
draft specific finding ids, add a plus-one, skip findings, challenge findings,
show already-covered findings, or cancel.

Drafts are plain conversation text until the user approves a preview. The skill
previews each line comment, review-body text, and the proposed review event
(`COMMENT` or `REQUEST_CHANGES`) before any GitHub write tool is used.

## Permissions

### Local Git Commands

The skill's `allowed-tools` frontmatter intentionally uses a small set of git
command patterns for preflight and diff collection:

- `git fetch origin refs/pull/*/merge` — fetch merge ref
- `git checkout --detach FETCH_HEAD` — checkout merge result
- `git rev-parse *` — record merge parents and related refs
- `git diff *` — verify clean state and collect status, numstat, and full diff

The repository root, worktree state, and origin URL checks are injected into the
skill prompt during preprocessing. The skill instructions still constrain actual
Bash use to the documented preflight and diff commands; workflow-spawned agents
have no Bash access.

All other Bash commands are denied.

### GitHub MCP Permissions

The plugin depends on the [github](../github) plugin.

Analysis requires these read capabilities:

- `pull_request_read` with `get`
- `pull_request_read` with `get_files` (MCP fallback only)
- `pull_request_read` with `get_review_comments`

The workflow and workflow-spawned agents must use read tools only. They are
explicitly instructed not to call write tools, draft pending reviews, submit
reviews, add comments, or resolve threads.

Collection agents run through the bundled `pr-review-github-collector` agent
type. That agent allows GitHub PR reads and disallows shell, local file, web, and
file mutation tools so large MCP responses do not lead to generated Python,
`jq`, `gh`, or other ad-hoc parsing scripts.

Specialist reviewers run through `pr-review-analysis-readonly`, which blocks
shell and mutation tools while allowing read-only repository inspection and
read-only MCP tools. In the local git path, specialists can use Read and Grep
on the merged checkout to inspect changed files and trace cross-file effects.

Approved posting, if the user chooses to post, requires these write
capabilities:

- `pull_request_review_write` to create and submit a review
- `add_comment_to_pending_review` to add approved line comments to a pending
  review

Write tools are used only after the skill has shown the exact preview and the
user has explicitly approved posting it.

## Validation

Basic plugin validation:

```bash
claude plugin validate ./pr-review-toolkit
npx markdownlint-cli2 --config ${CLAUDE_PROJECT_DIR}/.markdownlint-cli2.jsonc "pr-review-toolkit/**/*.md"
```

Representative PR validation should cover:

- small PRs with and without existing review comments
- PRs where existing human or bot comments fully cover a candidate finding
- partial-overlap and plus-one cases
- discussion-only findings
- large PRs with hundreds of files
- large PRs dominated by vendor, generated, or lockfile changes
- missing-test, error-handling, comment/doc, and type/model/interface changes
- PRs with meaningful positive observations
- local git worktree where `HEAD^2` matches PR `headSha`
- wrong `origin` remote (should fall back to MCP)
- dirty worktree (should fall back to MCP)
- PR with merge conflicts (merge ref fetch fails, should fall back to MCP)
- PRs with renames, copies, deletes, binary files, and paths with special
  characters

For each run, verify that PR metadata and review-thread context come from MCP
tools, local-git runs record manifest/full-diff provenance in
`reviewMeta.sources`, and MCP fallback runs record the fallback reason and
recovery counts. Also verify no generated parsing scripts are used, existing
review context affects recommendations, the review board is understandable, the
drafts remain editable, and posting requires explicit
approval.

## Prerequisites

- [github](../github) plugin (provides MCP tools for PR operations)
