# gws - Google Workspace CLI Plugin

Claude Code plugin providing Google Workspace CLI (`gws`) skills for Gmail, Calendar, Drive, Docs, Sheets, Slides, and Meet.

## Prerequisites

- **gws CLI**: Install with `npm install -g @googleworkspace/cli`
- **OAuth configured**: Run `gws auth login` and grant scopes for desired services

## Included Skills

### Service Skills

Core API access for each Google Workspace service:

- `gws-gmail` - Send, read, and manage email
- `gws-calendar` - Manage calendar events
- `gws-drive` - File and folder operations
- `gws-docs` - Document operations
- `gws-sheets` - Spreadsheet operations
- `gws-slides` - Presentation operations
- `gws-meet` - Meeting space management

### Helper Skills

Streamlined commands for common operations:

- `gws-gmail-send`, `gws-gmail-triage`, `gws-gmail-reply`, `gws-gmail-reply-all`, `gws-gmail-forward`, `gws-gmail-watch`
- `gws-calendar-insert`, `gws-calendar-agenda`
- `gws-drive-upload`
- `gws-sheets-append`, `gws-sheets-read`
- `gws-docs-write`

### Workflows

Multi-step productivity workflows:

- `gws-workflow` - Cross-service workflow patterns
- `gws-workflow-standup-report` - Generate daily standup reports
- `gws-workflow-meeting-prep` - Prepare for upcoming meetings
- `gws-workflow-email-to-task` - Convert emails to actionable tasks
- `gws-workflow-weekly-digest` - Weekly activity summary
- `gws-workflow-file-announce` - Share files with notifications

## Syncing Skills with Upstream

This plugin carries a curated subset of skills from the upstream
[gws CLI repository](https://github.com/googleworkspace/cli). The upstream
generates skills via `gws generate-skills` and publishes them under `skills/`
in the repo. We carry 28 of ~74 available skills (core services, helpers,
and workflows — no personas or recipes).

### Process

1. Check the installed CLI version (`gws --version`) against the latest
   [upstream release](https://github.com/googleworkspace/cli/releases).
   Update the CLI if needed.
2. For each local skill in `gws/skills/*/SKILL.md`, fetch the matching
   file from `googleworkspace/cli` `skills/` on the `main` branch.
3. Overwrite the local file with the upstream content. Do not add local
   customizations — take upstream wholesale.
4. Bump the plugin version in `.claude-plugin/plugin.json` (minor for
   content-only updates).
5. Validate: `claude plugin validate ./gws`

### Guidelines

- **Go pure upstream.** Local customizations (extra sections, modified
  tips) create merge debt and tend to duplicate what the Claude Code
  harness already handles (e.g., effort-level scaling via `CLAUDE_EFFORT`).
- **Frontmatter must match upstream format.** Version lives inside
  `metadata.version`, not as a top-level field. YAML arrays use block
  style (`- gws`), not inline (`["gws"]`).
- **New upstream skills** (chat, forms, keep, people, classroom, events,
  script, admin-reports, modelarmor, personas, recipes) can be pulled in
  by creating the corresponding `skills/<name>/` directory and copying
  the upstream SKILL.md. No other files are needed per skill.

## Links

- [gws CLI repository](https://github.com/googleworkspace/cli)
- [Claude Code plugins documentation](https://code.claude.com/docs/en/plugins)
