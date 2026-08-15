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
4. **Detects Kubernetes projects** (any remote owned by `kubernetes` or a
   `kubernetes-*` organization)
5. **Sets git config overrides** via `CLAUDE_ENV_FILE` environment variables

Then injects tailored git instructions covering:

- **Git Safety Protocol** -- never force push mainline, never skip hooks, prefer
  specific file staging, prefer new commits over amending, no bare `git stash`
  (the stash stack is shared across worktrees and sessions), review staged files
  for secrets before committing
- **Commit workflow** -- review changes, stage specific files, HEREDOC format,
  conventional commits format when detected
- **Branch workflow** -- create from mainline, conventional prefixes when detected,
  kebab-case naming
- **PR workflow** -- use GitHub MCP tools, fork-aware PR creation, update an
  existing PR instead of opening a duplicate, follow the repository's PR template
  when it has one (otherwise Summary + Test plan)
- **Kubernetes conventions** (when detected) -- no AI attribution trailers in
  commit messages, AI usage disclosed in the PR description instead

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
| Kubernetes project | Any remote URL owned by `kubernetes` or `kubernetes-*` |

### Kubernetes Projects

Kubernetes contributions have two extra requirements, applied automatically when
a `kubernetes` / `kubernetes-*` remote is detected:

| Requirement | Effect |
|-------------|--------|
| No AI attribution trailers | Commits omit `Assisted-by` (and any `Co-Authored-By` / `Generated-by` equivalent) |
| AI usage disclosure | The PR body states that AI tooling was used -- filling in the template's AI usage disclosure section when it has one, otherwise adding a line such as "This PR was created with the assistance of AI tooling." |

The existing rule that Claude never adds `Signed-off-by` (only the human
submitter can certify the DCO) already covers the other half of Kubernetes'
trailer requirements.

### Git Config Overrides

When `CLAUDE_ENV_FILE` is available, the plugin writes environment variables to
override git settings for the session (without modifying git config files):

| Setting | Value | Reason |
|---------|-------|--------|
| `branch.autosetupmerge` | `false` | Prevents unintended tracking when creating branches |

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
