# PR Review Toolkit

Reimplementation of Anthropic's
[pr-review-toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit)
as a single Workflow-based skill. The workflow collects shared PR context,
runs specialist reviewers, and returns an interactive review board for the
human reviewer.

## Usage

```text
/pr-review-toolkit:review-pr <github-pr-url>
```

## Review Flow

The skill parses a GitHub PR URL and launches the bundled workflow. The workflow:

- collects PR metadata, changed files, and review threads through GitHub MCP
  read tools
- fetches changed files one API page per collector agent, then merges the
  manifest in workflow variables
- selects relevant reviewer lenses from the manifest
- asks specialists for evidence-rich candidate findings
- synthesizes findings into a review board grouped by posting recommendation,
  existing-review overlap, and discussion value

The workflow does not draft or post comments. Drafting happens in the skill
conversation after the user selects findings. Posting requires an exact preview
and explicit final approval.

## Review Agents

| Agent | When it runs | What it does |
|-------|-------------|--------------|
| code-reviewer | Always | Reviews code for bugs, style, and guideline adherence (runs on Opus) |
| silent-failure-hunter | Changes touch error handling, try/catch, or fallback logic | Identifies silent failures and inadequate error handling |
| pr-test-analyzer | Functional code that should have corresponding tests | Analyzes test coverage completeness |
| comment-analyzer | Changes add or modify comments, docstrings, or docs | Checks comment accuracy and maintainability |
| type-design-analyzer | Changes introduce or modify type definitions in typed languages | Evaluates type design and invariant quality |

Agent selection is liberal: when in doubt, the agent runs. All agents execute in
parallel within a single workflow from the collected PR manifest and thread
context.

## Review Board

The workflow returns a review board grouped by outcome:

- `recommendedToPost` — high-signal findings that look postable by a human
  reviewer and are not already covered
- `possiblePlusOnes` — existing threads where an endorsement may help
- `partialOverlaps` — findings that add useful detail beyond an existing thread
- `discussionOnly` — useful reviewer notes that should not be posted yet
- `alreadyCovered` — findings fully covered by existing human or bot review
  threads
- `discarded` — weak, duplicate, low-confidence, or non-actionable findings

Each finding preserves the specialist's claim, evidence, reasoning, suggested
fix, confidence, source lens, and existing-review overlap rationale. The board
also includes positive observations, an action plan, coverage notes, PR metadata,
and review metadata.

## Interaction And Posting

After the board is presented, the user can ask to draft recommended findings,
draft specific finding ids, add a plus-one, skip findings, challenge findings,
show already-covered findings, or cancel.

Drafts are plain conversation text until the user approves a preview. The skill
previews each line comment, review-body text, and the proposed review event
(`COMMENT` or `REQUEST_CHANGES`) before any GitHub write tool is used.

## GitHub MCP Permissions

The plugin depends on the [github](../github) plugin.

Analysis requires these read capabilities:

- `pull_request_read` with `get`
- `pull_request_read` with `get_files`
- `pull_request_read` with `get_review_comments`

The workflow and workflow-spawned agents must use read tools only. They are
explicitly instructed not to call write tools, draft pending reviews, submit
reviews, add comments, or resolve threads.

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

For each run, verify that GitHub data comes from MCP tools, no generated parsing
scripts are used, existing review context affects recommendations, the review
board is understandable, the action plan is concise, drafts remain editable, and
posting requires explicit approval.

## Prerequisites

- [github](../github) plugin (provides MCP tools for PR operations)
