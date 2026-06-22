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
- synthesizes findings into a review board grouped by posting recommendation

The workflow does not post comments. Drafting and posting are intentionally
separate follow-up steps.

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

## Prerequisites

- [github](../github) plugin (provides MCP tools for PR operations)
