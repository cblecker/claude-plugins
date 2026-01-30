# Git Hooks

Safety controls and workflow suggestions for git operations.

## Architecture

All git-related Bash hooks are routed through a single router script (`scripts/git-bash-router.sh`) that:
- Uses pure jq for all command routing and logic
- Caches mainline branch detection via `CLAUDE_MAINLINE_BRANCH` environment variable
- Returns `null` for non-git commands (fast no-op)

**Performance:** ~15-20ms per Bash tool use vs ~400ms for multiple separate jq hooks.

**Portability:** Pure jq implementation ensures consistent behavior across Bash 3.2 (macOS system shell) and Bash 5.3+ (modern systems).

**Implementation:** Single `Bash` matcher in `hooks.json` pipes all Bash commands to the router.

## Hook Categories

| Category | Decision | Purpose |
|----------|----------|---------|
| Safety (hard) | `deny` | Block dangerous operations unconditionally |
| Safety (soft) | `ask` | Require explicit user permission |
| Suggestion | `additionalContext` | Nudge toward better workflows |
| Warning | `additionalContext` | Alert about potentially risky operations |

## Hooks

### 1. Force Push Protection (`git push`)

**Intent:** Prevent accidental force pushes that rewrite shared history.

**Logic:**
- Detects force flags: `--force`, `-f`, or combined flags like `-fu`
- Detects mainline branch in target (positional or refspec like `:main`)
- Force push to mainline → **DENY** (never allowed)
- Force push elsewhere → **ASK** (requires user permission)

**Why:** Force pushing to mainline breaks other contributors' branches, loses commits, and disrupts CI/CD. Force pushing to feature branches is sometimes needed (rebasing) but should be intentional.

### 2. Commit Skill Suggestion (`git commit`)

**Intent:** Encourage use of `/git:commit` skill for enhanced workflow.

**Logic:** Simple suggestion when `git commit` is detected.

**Why:** The skill provides mainline protection, conventional commits detection, pre-commit verification, and respects CLAUDE.md configuration.

### 3. Branch Skill Suggestion (`git checkout -b`, `git switch -c`)

**Intent:** Encourage use of `/git:branch` skill for smart naming.

**Logic:** Simple suggestion when branch creation is detected.

**Why:** The skill detects conventional commits and suggests appropriate branch prefixes (feat/, fix/, etc.).

### 4. Hard Reset Warning (`git reset`)

**Intent:** Alert before discarding uncommitted work.

**Logic:** Detects `--hard` flag in any position.

**Why:** `git reset --hard` permanently discards uncommitted changes. Users should consider `git stash` or creating a backup branch first.

### 5. Clean Warning (`git clean`)

**Intent:** Alert before permanently deleting untracked files.

**Logic:**
- Detects force flag: `--force`, `-f`, or combined flags
- Skips warning if dry-run flag present: `--dry-run`, `-n`

**Why:** `git clean -f` permanently deletes untracked files. Using `-n` first shows what would be deleted.

### 6. Rebase Warning (`git rebase`)

**Intent:** Alert when rebasing onto mainline branch.

**Logic:** Detects mainline branch name in rebase command.

**Why:** Rebasing onto mainline is often intentional but can cause issues if done accidentally on shared branches.

### 7. GitHub CLI Suggestion (`gh`)

**Intent:** Encourage use of GitHub MCP tools for better integration.

**Logic:** Simple suggestion when any `gh` command is detected.

**Why:** MCP tools provide better context and error handling than CLI.

### 8. Fork PR Owner Check (`mcp__plugin_github_github__create_pull_request`)

**Intent:** Catch when Claude forgets a repo is a fork and targets the wrong owner.

**Logic:**
- Checks if `upstream` remote exists (indicates fork setup)
- Extracts owner from upstream URL
- Warns if PR `owner` parameter doesn't match upstream owner

**Why:** The primary failure mode when working with forks is creating PRs against the fork instead of upstream.

## Testing

### Force Push Tests

| Command | Expected |
|---------|----------|
| `git push --force origin main` | **DENY** |
| `git push -f origin main` | **DENY** |
| `git push -fu origin main` | **DENY** |
| `git push --force origin feature` | **ASK** |
| `git push --force-with-lease origin feature` | **ASK** |
| `git push --force-if-includes origin feature` | **ASK** |
| `git push origin feature` | (no hook output) |

### Skill Suggestion Tests

| Command | Expected |
|---------|----------|
| `git commit -m "test"` | Suggestion: use `/git:commit` |
| `git checkout -b feature` | Suggestion: use `/git:branch` |
| `git switch -c feature` | Suggestion: use `/git:branch` |

### Warning Tests

| Command | Expected |
|---------|----------|
| `git reset --hard HEAD` | Warning: data loss |
| `git reset HEAD --hard` | Warning: data loss |
| `git clean -f` | Warning: permanent deletion |
| `git clean -fd` | Warning: permanent deletion |
| `git clean -n` | (no warning - dry-run) |
| `git clean -nfd` | (no warning - dry-run) |
| `git rebase main` | Warning: rebasing onto mainline |

### MCP Tests

| Scenario | Expected |
|----------|----------|
| `gh issue list` | Suggestion: use MCP tools |
| PR create with upstream, owner mismatch | Warning: fork detected |
| PR create with upstream, owner matches | (no warning) |
| PR create without upstream remote | (no warning) |

## Technical Notes

### Router Implementation

- **Architecture:** Pure jq for all command routing and logic
- **Command routing:** jq `startswith()` function with conditional logic
- **Helper functions:** jq `def` for reusable patterns (force flags, dry-run flags, mainline detection)
- **Mainline caching:** Bash checks `CLAUDE_MAINLINE_BRANCH` before calling detect script
- **No-op return:** jq `null` for non-matching commands
- **Portability:** Consistent behavior across Bash 3.2 (macOS) and Bash 5.3+ (modern systems)

### jq Patterns

- Use `(.a == .b | not)` instead of `.a != .b` - bash escapes `!` as `\!`
- Test for flags with word boundaries: `test("\\s--force|\\s-[a-zA-Z]*f")`
- Mainline detection via `${CLAUDE_PLUGIN_ROOT}/scripts/detect-mainline.sh`

### Hook Matchers

Hook matchers are regex patterns matched against tool names:
- `Bash` - matches the Bash tool exactly
- `Bash|Write` - matches Bash or Write tools
- `mcp__plugin_.*` - matches any MCP plugin tool
- See [Hook documentation](https://code.claude.com/docs/en/hooks) for official syntax
