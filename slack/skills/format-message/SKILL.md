---
name: format-message
description: >-
  Format a message in Slack's composer markup. Use when drafting, rewriting,
  or converting a Slack message the user will copy and paste into Slack. Does
  not apply when sending through Slack connector tools.
---

## Delivery

Put the whole message in one fenced code block, with a four-backtick fence
when the message contains a code block. Keep commentary outside the fence.

Write each paragraph and list item on a single line; Slack keeps every newline.

After the block, tell the user once: if the markup shows as plain text after
pasting, select it and press Cmd+Shift+F (Ctrl+Shift+F on Windows/Linux).

## Syntax

| Want | Write | Not |
|------|-------|-----|
| Bold | `*text*` | `**text**` |
| Italic | `_text_` | `*text*` |
| Strikethrough | `~text~` | `~~text~~` |
| Code block | triple backticks on their own lines | a language tag |
| Quote | `>` at the start of each line | |
| Link | `[text](https://example.com)` or a bare URL | |
| Bulleted list | lines starting with `-` | nested lists |
| Numbered list | lines starting with `1.`, `2.` | |

Put identifiers and literal `*`, `_`, `~` characters in inline code.

## No Slack equivalent

- **Headings**: a bold line on its own.
- **Tables**: one `*label:* value` line per row for two columns; a code block
  with space-aligned columns for three or more.
- **Horizontal rules**: a blank line.
- **Task lists**: plain `-` items.

## Mentions

Write `@name` and `#channel` as plain text. Write `@here`, `@channel`, or
`@everyone` only when the user asks for it.

## Example

Markdown draft:

````markdown
## Deploy status

**Done:** API rollout ([PR](https://example.com/pr/1))

| Service | State |
|---------|-------|
| api | ok |
| web | pending |

```bash
make deploy
```
````

Slack form:

````text
*Deploy status*

*Done:* API rollout ([PR](https://example.com/pr/1))

*api:* ok
*web:* pending

```
make deploy
```
````
