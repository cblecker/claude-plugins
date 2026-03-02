# GitHub Plugin

GitHub MCP server with selected toolsets enabled for repository management, code security, discussions, notifications, and more.

## Components

### MCP Server

HTTP-based MCP server connected to `api.githubcopilot.com` with the following toolsets enabled:

- `default` — repos, issues, pull requests, commits, files, users
- `actions` — workflow runs, jobs, artifacts, logs
- `orgs` — organization membership and teams
- `labels` — repository label management
- `notifications` — notification listing and management
- `discussions` — repository discussions and comments
- `gists` — gist creation and management
- `projects` — GitHub Projects (v2) management
- `code_security` — code scanning alerts
- `secret_protection` — secret scanning alerts
- `dependabot` — Dependabot alerts
- `security_advisories` — global and repository security advisories
- `github_support_docs_search` — GitHub product documentation search

### Hooks

- **SessionStart** — instructs Claude to prefer GitHub MCP tools over the `gh` CLI and `WebFetch` for all GitHub operations

## Configuration

This plugin requires the `GITHUB_PERSONAL_ACCESS_TOKEN` environment variable to be set with a valid GitHub Personal Access Token.

## Documentation

For more information about the GitHub MCP server, visit:
<https://github.com/github/github-mcp-server>
