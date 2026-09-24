# GitHub Plugin

GitHub MCP server with a curated tool allowlist for pull requests, issues, notifications, read-only repository access, and code security.

## Components

### MCP Server

HTTP-based MCP server connected to `api.githubcopilot.com`. Tools are deferred and loaded on demand via tool search, keeping them out of the context window until needed.

The server is configured with two headers in `.mcp.json`:

- `X-MCP-Toolsets` enables these toolsets in full, including tools added to them upstream:
  - `gists` — gist reading, creation, and updates
  - `code_security` — code scanning alerts
  - `security_advisories` — global and repository security advisories
  - `dependabot` — Dependabot alerts
  - `github_support_docs_search` — GitHub product documentation search (remote-only)
- `X-MCP-Tools` adds individual tools on top. Because the `default` toolset is not
  named, nothing else is enabled — new upstream tools in these areas require an
  explicit opt-in:
  - **Pull requests** — `pull_request_read`, `search_pull_requests`, `list_pull_requests`,
    `create_pull_request`, `update_pull_request`, `pull_request_review_write`,
    `add_comment_to_pending_review`, `add_reply_to_pull_request_comment`
  - **Issues** — `issue_read`, `search_issues`, `list_issues`, `issue_write`,
    `add_issue_comment`, `update_issue_comment`, `sub_issue_write`, `list_issue_types`,
    `list_issue_fields`
  - **Repositories (read-only)** — `get_file_contents`, `search_code`, `search_repositories`,
    `list_branches`, `list_commits`, `get_commit`, `search_commits`, `list_tags`, `get_tag`,
    `list_releases`, `get_latest_release`, `get_release_by_tag`
  - **Actions (read-only)** — `actions_list`, `actions_get`, `get_job_logs`
  - **Notifications** — `list_notifications`, `get_notification_details`,
    `dismiss_notification`, `manage_notification_subscription`
  - **Users and teams** — `get_me`, `get_teams`, `get_team_members`, `search_users`
  - **Other** — `check_dependency_vulnerabilities` (remote-only)

To enable another tool, add its exact name to `X-MCP-Tools`; an unknown name
causes the server to reject the connection.

### Hooks

- **SessionStart** — instructs Claude to prefer GitHub MCP tools over the `gh` CLI and `WebFetch` for all GitHub operations

### Skills

- **triage-prs** (`/github:triage-prs [owner/repo]`) — triages open PRs where you are
  assigned or a requested reviewer. Sweeps stale notification threads left by PRs
  that have since closed or merged, then auto-classifies open PRs from search data —
  skipping ones you've already engaged with and, on Prow-managed repos, dismissing
  notifications for `needs-rebase` PRs and unsubscribing entirely from
  `lgtm`+`approved` PRs — then investigates only the remainder with parallel
  subagents and presents batched options to unassign, remove review requests, or
  unsubscribe. Explicit invocation only —
  Claude never triggers it automatically. The target repo is taken from the
  optional `owner/repo` argument, or detected from the `upstream` (preferred)
  or `origin` git remote. Prow-managed repos are auto-detected and acted on via
  bot commands (`/unassign`, `/uncc`); on other repos, removing a review request
  requires an authenticated `gh` CLI (the one operation the GitHub MCP server
  does not cover) — without it, that single action is reported for manual
  follow-up instead.

## Configuration

This plugin requires the `GITHUB_PERSONAL_ACCESS_TOKEN` environment variable to be set with a valid GitHub Personal Access Token.

## Documentation

For more information about the GitHub MCP server, visit:
<https://github.com/github/github-mcp-server>
