# Git Plugin

Replaces Claude Code's built-in git instructions with enhanced, project-aware
versions injected at session start.

## Prerequisites

Set `includeGitInstructions: false` in your Claude Code settings to disable
the built-in git instructions. This plugin provides its own replacement.

In `.claude/settings.json` or `.claude/settings.local.json`:

```json
{
  "includeGitInstructions": false
}
```

Or set the environment variable `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1`.

## What It Does

At session start, the plugin runs a detection script that:

1. **Detects your mainline branch** (via `origin HEAD`, falls back to `main`/`master`)
2. **Detects conventional commits** (commitlint config or commit history analysis)
3. **Detects fork setup** (checks for `upstream` remote)

Then injects tailored git instructions covering:

- **Git Safety Protocol** -- never force push mainline, never skip hooks, prefer
  specific file staging, prefer new commits over amending
- **Commit workflow** -- review changes, stage specific files, HEREDOC format,
  conventional commits format when detected
- **Branch workflow** -- create from mainline, conventional prefixes when detected,
  kebab-case naming
- **PR workflow** -- use GitHub MCP tools, fork-aware PR creation, structured body
  format (Summary + Test plan)

## Usage

Install the plugin and set the prerequisite. The plugin works automatically --
no slash commands or special invocations needed. Claude receives the right git
instructions from the start of every session.

## Configuration

The plugin auto-detects repository conventions at session start.

| Setting | Detection Method |
|---------|-----------------|
| Mainline branch | `git ls-remote --symref origin HEAD`, local fallback |
| Conventional commits | commitlint config files, commit history pattern matching |
| Fork setup | Presence of `upstream` remote |

## Testing

Validate the plugin:

```bash
claude plugin validate ./git
```

Test the script standalone in any git repository:

```bash
bash /path/to/git/scripts/git-instructions.sh
```

## License

MIT
