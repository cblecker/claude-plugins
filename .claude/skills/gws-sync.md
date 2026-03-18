---
name: gws-sync
description: "Sync upstream gws CLI skills into the gws plugin. Use when asked to: sync gws skills, update gws plugin, refresh google workspace skills, curate gws, add new gws skills."
user_invocable: true
---

# Sync GWS Skills

Synchronize upstream `gws generate-skills` output with the curated skill set in `gws/skills/`.

## Process

### 1. Generate upstream skills

```bash
GWS_TMP_DIR="$(mktemp -d)"
gws generate-skills --output-dir "$GWS_TMP_DIR"
```

### 2. Check current OAuth scopes

```bash
gws auth status --format json
```

Extract the `scopes` array. Map scopes to services:

| Scope pattern | Service |
|---|---|
| `gmail` | Gmail |
| `calendar` | Calendar |
| `drive` | Drive |
| `documents` | Docs |
| `spreadsheets` | Sheets |
| `presentations` | Slides |
| `meetings` | Meet |
| `chat` | Chat |
| `classroom` | Classroom |
| `forms` | Forms |
| `tasks` | Tasks |
| `admin.reports` | Admin Reports |

### 3. Inventory current skills

List all directories in `gws/skills/` to get the current vendored set.

### 4. Diff upstream vs current

For each upstream skill directory:

1. Read its `SKILL.md` frontmatter to get `metadata.openclaw.requires.skills` (default to `[]` if missing)
2. Check if ALL required service skills have matching OAuth scopes
3. Categorize:
   - **New + scoped**: upstream skill not in current set, all required services have scopes
   - **New + unscoped**: upstream skill not in current set, missing required service scopes
   - **Updated**: exists in both, content differs (compare file contents)
   - **Removed**: in current set but not in upstream
   - **Unchanged**: identical in both

Always include `gws-shared` regardless of scopes (it has no service dependency).

### 5. Present findings

Use AskUserQuestion to present:
- New scoped skills (recommended for inclusion)
- New unscoped skills (available if scopes are added)
- Updated skills (recommend updating)
- Removed skills (recommend removing)

Let the user select which to add/update/remove.

### 6. Apply changes

For each selected skill:
- Copy the `SKILL.md` from the upstream temp directory to `gws/skills/<skill-name>/SKILL.md`
- Create the directory if it doesn't exist

For removals, delete the skill directory from `gws/skills/`.

### 7. Bump version

After applying changes, bump the patch version in `gws/.claude-plugin/plugin.json`.

### 8. Cleanup

```bash
rm -rf "${GWS_TMP_DIR:?}"
```

### 9. Summary

Report what was added, updated, and removed.
