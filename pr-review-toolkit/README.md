# PR Review Toolkit

Reimplementation of Anthropic's
[pr-review-toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit)
as a single Workflow-based skill with dynamic agent selection, replacing the
upstream agents + command architecture.

## Usage

```text
/pr-review-toolkit:review-pr <github-pr-url>
```

## Review Agents

| Agent | When it runs | What it does |
|-------|-------------|--------------|
| code-reviewer | Always | Reviews code for bugs, style, and guideline adherence (runs on Opus) |
| silent-failure-hunter | Code files changed | Identifies silent failures and inadequate error handling |
| pr-test-analyzer | Code files changed | Analyzes test coverage completeness |
| comment-analyzer | Docs changed or >= 3 files | Checks comment accuracy and maintainability |
| type-design-analyzer | Typed-language files changed | Evaluates type design and invariant quality |

Agent selection is liberal: when in doubt, the agent runs. All agents execute in
parallel within a single workflow, and their lifecycle is managed automatically.

## Prerequisites

- [github](../github) plugin (provides MCP tools for PR operations)
