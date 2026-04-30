---
name: gws-workflow-meeting-prep
version: 1.0.0
description: "Google Workflow: Prepare for your next meeting: agenda, attendees, and linked docs."
metadata:
  openclaw:
    category: "productivity"
    requires:
      bins: ["gws"]
    cliHelp: "gws workflow +meeting-prep --help"
---

# workflow +meeting-prep

> **PREREQUISITE:** Read `../gws-shared/SKILL.md` for auth, global flags, and security rules. If missing, run `gws generate-skills` to create it.

Prepare for your next meeting: agenda, attendees, and linked docs

## Usage

```bash
gws workflow +meeting-prep
```

## Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--calendar` | — | primary | Calendar ID (default: primary) |
| `--format` | — | — | Output format: json (default), table, yaml, csv |

## Examples

```bash
gws workflow +meeting-prep
gws workflow +meeting-prep --calendar Work
```

## Tips

- Read-only — never modifies data.
- Shows the next upcoming event with attendees and description.
- Scale output verbosity based on `${CLAUDE_EFFORT}`: time, title, and attendees only at `low`, standard prep summary at `medium` (default), full briefing with linked doc summaries and suggested talking points at `high`.

## See Also

- [gws-shared](../gws-shared/SKILL.md) — Global flags and auth
- [gws-workflow](../gws-workflow/SKILL.md) — All cross-service productivity workflows commands
