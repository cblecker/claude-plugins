# PR Review Toolkit Rewrite Context

This document records background context gathered while planning the next
iteration of `pr-review-toolkit`. It is intentionally descriptive rather than
prescriptive. Requirements live in `PR_REVIEW_REQUIREMENTS.md`; implementation
steps live in `WORKFLOW_REWRITE_PLAN.md`.

## Current Plugin Snapshot

The current plugin is small:

```text
pr-review-toolkit/
  README.md
  .claude-plugin/plugin.json
  skills/review-pr/SKILL.md
  skills/review-pr/review-pr.js
```

The plugin currently implements `/pr-review-toolkit:review-pr <github-pr-url>`
as a single Workflow-backed skill. The skill collects PR metadata, chooses
agents, invokes `review-pr.js`, presents findings, lets the user select findings,
drafts comments, and posts a review.

The Workflow script embeds the upstream specialist prompts and runs selected
agents in parallel. It then performs additional phases:

- per-finding verification
- existing review thread collection
- duplicate and partial-overlap classification
- optional resolved-thread verification

## Current Pain Points

The current design improved lifecycle management but introduced rigidity.

- All specialists are forced into a minimal common output shape:
  `file`, `line`, `severity`, `confidence`, `title`, and `description`.
- That common shape erases specialist-specific reasoning, such as:
  - why a test gap matters
  - what hidden errors a broad catch may swallow
  - what type invariants are weak or unenforced
  - whether a finding is useful but not worth posting
- Additional verification and classification layers were added to compensate for
  the narrow output.
- The result feels closer to a deterministic comment pipeline than an
  interactive co-review.

## Upstream Plugin Baseline

The upstream `anthropics/claude-plugins-official` version was built around
separate markdown agents plus a loose `review-pr` command.

Useful properties from upstream:

- agents kept their own domain-specific output style
- agents behaved like a review team for comprehensive PR review
- the command could choose relevant review aspects when needed
- results were aggregated into a review summary
- the final output was easy to scan as an action plan
- strengths and positive observations were preserved
- the system felt flexible and conversational

Problems observed with the upstream-style approach:

- subagent orchestration could be flaky
- output formatting could vary
- lifecycle management was less predictable

The planned design should keep upstream's flexible specialist reasoning while
using Workflow orchestration for repeatability and lifecycle management.

The desired pull from upstream is not primarily standalone agent UX. The main
value to preserve is the feel of a comprehensive team review: multiple distinct
review lenses contributing to one useful action plan.

## Claude Code Workflow Constraints

Dynamic Workflows are a strong fit for the non-interactive analysis phase:

- workflows move orchestration into JavaScript
- intermediate results live in script variables instead of the main
  conversation context
- workflows are appropriate for large multi-agent tasks such as codebase audits,
  500-file migrations, and cross-checked research
- workflow runs can be inspected through `/workflows`

Workflow constraints that shape the design:

- workflows do not support mid-run user input
- workflow scripts coordinate agents; agents perform tool calls
- workflow scripts do not directly use filesystem or shell access
- workflow-spawned agents inherit the session tool allowlist
- MCP tools outside the allowlist may still prompt mid-run

Therefore, the analysis workflow should return a review board, then the main
skill conversation should handle user interaction, drafting, approval, and
posting.

## Claude Code Subagent Constraints

Subagents are still useful as specialist reviewers, but they are not the right
top-level orchestrator for this workflow.

Useful properties:

- each subagent has its own context
- subagents can have focused prompts and tool restrictions
- subagents are appropriate for side tasks that would otherwise flood the main
  conversation

Constraints:

- plain subagent orchestration keeps the main model responsible for coordinating
  pagination, data assembly, synthesis, and lifecycle
- plugin-shipped agents support fields such as `tools`, `disallowedTools`,
  `model`, `effort`, and `maxTurns`
- plugin-shipped agents do not support `permissionMode`, `mcpServers`, or
  `hooks`

The resulting model is: Workflow as orchestrator, subagents as specialists, main
skill as interactive reviewer interface.

## GitHub Data Handling Context

GitHub data should be fetched through MCP tools only.

The major failure mode to avoid is the model deciding to write just-in-time
Python, shell, `gh`, or `jq` scripts to paginate and parse large GitHub
responses. This is especially likely on large PRs with hundreds of changed files
and large line deltas.

The planned design should centralize data collection into a narrow workflow
phase. The collection phase should gather PR metadata, changed-file pages, and
review comments/threads once, then pass structured context to downstream
specialists.

## Large PR Context

One motivating example was a PR with:

- 509 changed files
- +37,976 lines
- -153,784 lines

Many changed files may be vendored or generated, but agents still need awareness
of the whole PR shape. The intended pattern is not "tiny packets only"; it is:

- complete manifest for whole-PR awareness
- categorized low-signal areas
- focused detailed context where review value is highest
- honest coverage summary
- user-directed expansion when needed

## Key Design Decisions

### Use Workflow For Analysis

Workflow orchestration is the right fit for collection, specialist fan-out, and
synthesis because it keeps intermediate state out of the main conversation and
can coordinate more agents than a normal turn.

### Keep User Interaction Outside Workflow

The human co-review loop must stay in the main skill conversation because
Workflows cannot pause for mid-run user input.

### Return A Review Board, Not Final Comments

The workflow should produce a review board grouped by recommendation:

- recommended to post
- possible plus-one
- partial overlap
- discussion-only
- already covered
- weak or discarded

Final comment drafting should happen only after the user selects what to include.

### Preserve Specialist Reasoning

Specialists should return evidence-rich candidate findings. The output should be
structured enough to synthesize but flexible enough to preserve domain-specific
judgment.

### Preserve Comprehensive Team Review

The main product surface should be the comprehensive review workflow. Specialist
agents may remain internal implementation pieces. Standalone specialist commands
or agents are lower priority unless they directly improve the team-review
workflow.

### Preserve Action-Plan Output

The final review board should stay easy to scan, similar to the upstream
toolkit's aggregate review summary. It should highlight critical issues,
important issues, suggestions, strengths, and recommended next action while also
adding newer context-aware groups such as already-covered, partial-overlap, and
possible plus-one.

### Separate Read And Write Tooling

The analysis phase should use GitHub MCP read tools only. GitHub MCP write tools
should be reserved for the final approved posting step.

## Open Implementation Questions

The public docs validate the architecture but do not fully specify the Workflow
JavaScript runtime API. A small local capability spike should answer:

- whether Workflow JS can import sibling modules
- whether Workflow JS can read bundled prompt/schema files
- which `agent()` options are supported reliably
- how structured-output failures are represented
- whether workflow-spawned agents can be constrained to specific MCP tools from
  the workflow invocation
- practical limits for MCP response sizes and Workflow variables

Until those are answered, the first implementation should stay conservative:

- one skill
- one bundled Workflow JS file
- embedded prompts and schemas
- read-only GitHub MCP analysis
- review-board output only
- no posting from Workflow
