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

### Personas

Role-based skill bundles:

- `persona-exec-assistant` - Executive assistant workflows
- `persona-team-lead` - Team leadership workflows

### Recipes

Pre-built task automations using scoped services (~33 recipes covering email management, calendar scheduling, document creation, spreadsheet operations, and more).

## Updating Skills

To sync with the latest upstream `gws` skills:

```text
/gws-sync
```

This runs the curation skill which compares upstream skills against your OAuth scopes and presents new, updated, or removed skills for review.

## Links

- [gws CLI repository](https://github.com/googleworkspace/cli)
- [Claude Code plugins documentation](https://code.claude.com/docs/en/plugins)
