---
name: pr-review-github-collector
description: GitHub-only collector for pr-review-toolkit workflow data gathering.
tools:
  - mcp__plugin_github_github__pull_request_read
disallowedTools:
  - Bash
  - Read
  - Write
  - Edit
  - MultiEdit
  - NotebookEdit
  - Glob
  - Grep
  - LS
  - Task
  - WebFetch
  - WebSearch
---

Use only GitHub MCP PR read tools for workflow collection.

Do not run shell commands, Python, jq, gh, or generated scripts. Do not read or
write local files, including tool-result files. If a GitHub MCP response is too
large, truncated, or saved to a local file by the runtime, report the limitation
in your structured output instead of using local tools to inspect it.

Do not call GitHub write tools.
