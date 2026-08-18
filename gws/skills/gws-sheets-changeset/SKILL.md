---
name: gws-sheets-changeset
description: "Google Sheets: Build a values.batchUpdate JSON body from a spreadsheet read through the Google Drive connector (no gws CLI available), for later execution with gws."
metadata:
  version: 1.0.0
  openclaw:
    category: "productivity"
---

# sheets changeset (Drive connector → gws)

> **LOCAL SKILL** — not from upstream `gws generate-skills`; skipped by the upstream
> sync. Self-contained: needs neither `gws-shared` nor the `gws` binary.

## When to Use

- You have **no** `gws` CLI (e.g. Claude.ai with the Google Drive connector) and read the
  sheet with `read_file_content` (markdown grid) or `download_file_content` (CSV export).
- The user wants cell edits applied later by a session that has `gws`.

**Not for:** sessions that have `gws` (call the API directly); structural changes —
merges, formatting, inserting/deleting rows or tabs. Say those are out of scope and
suggest the Sheets UI or a `gws` session.

## Division of Labor

You see one tab's displayed values and nothing else: no merges, no formulas, no other
tabs, no guarantee the export is complete. Build the body from what you see and
**declare everything you could not verify** in the handoff. The `gws` runner has the
live sheet and confirms those assumptions before applying.

## Reading the Connector Output

| What you see | What it means |
|--------------|---------------|
| Empty first table row (`\|  \|  \|`) plus alignment row | Connector artifact. **The first data row of the table is sheet row 1.** (CSV has no artifact: line 1 is row 1) |
| Only one grid | Only the **first tab** is exported. Build changes only for a tab whose contents you have seen; ask the user to paste another tab if needed and prefix its ranges `'Tab Name'!A1` (double any apostrophe in the name) |
| Values, never formulas | Computed cells show their result. Flag before overwriting anything that looks computed |
| One value followed by blank cells in a title/header-like row | Likely **merged** cells |

The Drive file `id` is the `spreadsheetId`.

## Output Contract

Write exactly this shape (nothing else at the top level):

```json
{
  "valueInputOption": "USER_ENTERED",
  "data": [
    { "range": "A2:C2", "values": [["Alice", 100, true]] },
    { "range": "'Sheet2'!B5", "values": [["=SUM(B1:B4)"]] }
  ]
}
```

- One `data` entry per contiguous rectangle; `values` is row-major and must not exceed
  the range's shape (fewer values leave the rest untouched).
- `null` = leave that cell untouched; `""` = clear it.
- Merged cells: write only the **anchor (top-left) cell**. A value supplied for a covered
  cell is silently discarded — the API still reports success. Use `null` or split the
  range so covered cells get no value.
- `USER_ENTERED` so numbers, dates, booleans, and `=formulas` parse; `RAW` only when the
  user wants literal strings.
- Append rows as ordinary `data` entries after the last row you can see; the anchor row
  goes in Assumptions.
- Prefer several small ranges over one large one — a mistake then clobbers less.

## Handoff

Deliver three things:

1. The JSON file, named `<sheet-slug>-changes.json`.
2. The exact command — the `spreadsheetId` is a URL param, not part of the body:

   ```bash
   gws sheets spreadsheets values batchUpdate \
     --params '{"spreadsheetId":"<ID>"}' \
     --json "$(cat <sheet-slug>-changes.json)" --dry-run   # drop --dry-run to apply
   ```

3. A summary in exactly this shape:

   ```text
   Changes: A1 title; B3:D3 AnnaLena visited; A6:B6 new row Dachi
   Assumptions: A1:D1 merged (anchor-only write); first tab; row 6 is the first
     empty row
   ```

   `Assumptions` always lists suspected merges, cells that may hold formulas, the target
   tab, and the anchor row of every append. The runner confirms them against the live
   sheet before dropping `--dry-run`: last row and formulas via `values get` with
   `valueRenderOption: FORMULA`; merges via `spreadsheets get` with
   `fields: sheets(properties(title,sheetId),merges)`.

> [!CAUTION]
> `batchUpdate` is a **write** — the `gws` runner confirms with the user before dropping
> `--dry-run`.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Counting the empty header artifact as row 1 | First data row of the table = row 1 |
| `--json @file.json` | Not supported. Use `--json "$(cat file.json)"` |
| A `spreadsheets.batchUpdate` (`requests[]`) body or invented `sheetId`s | Values-only: A1 ranges, no `sheetId` |
| `values` larger than `range` | Rejected; trim the values or widen the range |

## See Also

- [gws-sheets](../gws-sheets/SKILL.md) — All read and write spreadsheets commands
- [gws-sheets-read](../gws-sheets-read/SKILL.md) — Read values with `gws`
