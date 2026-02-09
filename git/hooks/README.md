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

| Category | Event | Decision | Purpose |
|----------|-------|----------|---------|
| Skill Enforcement | `PreToolUse` | `deny` | Block direct git commands, enforce skill usage |
| Safety (hard) | `PreToolUse` | `deny` | Block dangerous operations unconditionally |
| Safety (soft) | `PreToolUse` | `ask` | Require explicit user permission |
| Warning | `PreToolUse` | `additionalContext` | Alert about potentially risky operations |

## Hooks

### 1. Skill Enforcement (`PreToolUse` for `Bash`)

**Intent:** Enforce skill usage for commit/branch/PR operations by blocking direct git commands.

**Logic:**
- Detects `git commit` commands → **DENY**, suggest `git:commit` skill
- Detects `git checkout -b`, `git checkout --branch`, `git switch -c`, `git switch --create` → **DENY**, suggest `git:branch` skill
- Detects `gh pr create` → **DENY**, suggest `git:pr` skill
- Skills can bypass enforcement by prefixing commands with `GIT_WORKFLOWS_OVERRIDE=1`
- Safety checks always apply, even with override prefix

**Override Mechanism:**
- Skills instruct Claude to prefix git commands with `GIT_WORKFLOWS_OVERRIDE=1`
- Example: `GIT_WORKFLOWS_OVERRIDE=1 git commit -m "feat: add auth"`
- Override only bypasses skill enforcement, not safety checks
- Override is auditable and visible in the command itself

**Why PreToolUse:** Fires on every tool call regardless of origin (user-initiated or autonomous). UserPromptSubmit only fires on user prompts, missing autonomous actions like multi-step tasks.

**Implementation:** Integrated into `scripts/git-bash-router.sh` using `cmd_match()` helper that detects commands at start or after `&&`/`;` with optional override prefix.

### 2. Force Push Protection (`git push`)

**Intent:** Prevent accidental force pushes that rewrite shared history.

**Logic:**
- Detects force flags: `--force`, `-f`, or combined flags like `-fu`
- Detects mainline branch in target (positional or refspec like `:main`)
- Force push to mainline → **DENY** (never allowed)
- Force push elsewhere → **ASK** (requires user permission)

**Why:** Force pushing to mainline breaks other contributors' branches, loses commits, and disrupts CI/CD. Force pushing to feature branches is sometimes needed (rebasing) but should be intentional.

### 3. Hard Reset Warning (`git reset`)

**Intent:** Alert before discarding uncommitted work.

**Logic:** Detects `--hard` flag in any position.

**Why:** `git reset --hard` permanently discards uncommitted changes. Users should consider `git stash` or creating a backup branch first.

### 4. Clean Warning (`git clean`)

**Intent:** Alert before permanently deleting untracked files.

**Logic:**
- Detects force flag: `--force`, `-f`, or combined flags
- Skips warning if dry-run flag present: `--dry-run`, `-n`

**Why:** `git clean -f` permanently deletes untracked files. Using `-n` first shows what would be deleted.

### 5. Rebase Warning (`git rebase`)

**Intent:** Alert when rebasing onto mainline branch.

**Logic:** Detects mainline branch name in rebase command.

**Why:** Rebasing onto mainline is often intentional but can cause issues if done accidentally on shared branches.

### 6. Fork PR Owner Check (`mcp__plugin_github_github__create_pull_request`)

**Intent:** Catch when Claude forgets a repo is a fork and targets the wrong owner.

**Logic:**
- Checks if `upstream` remote exists (indicates fork setup)
- Extracts owner from upstream URL
- Warns if PR `owner` parameter doesn't match upstream owner

**Why:** The primary failure mode when working with forks is creating PRs against the fork instead of upstream.

## Testing

### Skill Enforcement Tests

| Command | Expected |
|---------|----------|
| `git commit -m "test"` | **DENY**, suggest git:commit skill |
| `git add . && git commit -m "test"` | **DENY**, suggest git:commit skill (chained) |
| `GIT_WORKFLOWS_OVERRIDE=1 git commit -m "test"` | Pass through (override) |
| `git add . && GIT_WORKFLOWS_OVERRIDE=1 git commit -m "test"` | Pass through (override in chain) |
| `git checkout -b feat/test` | **DENY**, suggest git:branch skill |
| `git switch -c feat/test` | **DENY**, suggest git:branch skill |
| `GIT_WORKFLOWS_OVERRIDE=1 git switch -c feat/test` | Pass through (override) |
| `gh pr create --title "test"` | **DENY**, suggest git:pr skill |
| `GIT_WORKFLOWS_OVERRIDE=1 gh pr create --title "test"` | Pass through (override) |
| `GIT_WORKFLOWS_OVERRIDE=1 git push --force origin main` | **DENY** (safety always applies) |
| `git status` | Pass through (not blocked) |

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
| PR create with upstream, owner mismatch | Warning: fork detected |
| PR create with upstream, owner matches | (no warning) |
| PR create without upstream remote | (no warning) |

### Running Tests

**Environment Setup:**

The router script requires environment variables to be set:

```bash
export CLAUDE_PLUGIN_ROOT=<path-to-git-plugin>  # e.g., ~/claude-plugins/git
export CLAUDE_MAINLINE_BRANCH=main  # Optional, will auto-detect if not set
```

**Single Test Example:**

```bash
echo '{"tool_input":{"command":"git commit -m \"test\""}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | \
  jq -c '.hookSpecificOutput.permissionDecision // "pass"'
# Expected: "deny"
```

**Full Test Suite:**

```bash
export CLAUDE_PLUGIN_ROOT=<path-to-git-plugin>
export CLAUDE_MAINLINE_BRANCH=main

# Test 1: git commit enforcement
echo '{"tool_input":{"command":"git commit -m \"test\""}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | jq -c '.hookSpecificOutput.permissionDecision // "pass"'
# Expected: "deny"

# Test 2: git commit with override
echo '{"tool_input":{"command":"GIT_WORKFLOWS_OVERRIDE=1 git commit -m \"test\""}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | jq -c '. // "null"'
# Expected: "null" (pass through)

# Test 3: chained git commit
echo '{"tool_input":{"command":"git add . && git commit -m \"test\""}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | jq -c '.hookSpecificOutput.permissionDecision // "pass"'
# Expected: "deny"

# Test 4: chained with override
echo '{"tool_input":{"command":"git add . && GIT_WORKFLOWS_OVERRIDE=1 git commit -m \"test\""}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | jq -c '. // "null"'
# Expected: "null" (pass through)

# Test 5: git checkout -b enforcement
echo '{"tool_input":{"command":"git checkout -b feat/test"}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | jq -c '.hookSpecificOutput.permissionDecision // "pass"'
# Expected: "deny"

# Test 6: git switch -c with override
echo '{"tool_input":{"command":"GIT_WORKFLOWS_OVERRIDE=1 git switch -c feat/test"}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | jq -c '. // "null"'
# Expected: "null" (pass through)

# Test 7: gh pr create enforcement
echo '{"tool_input":{"command":"gh pr create --title \"test\""}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | jq -c '.hookSpecificOutput.permissionDecision // "pass"'
# Expected: "deny"

# Test 8: force push to main with override (safety still applies)
echo '{"tool_input":{"command":"GIT_WORKFLOWS_OVERRIDE=1 git push --force origin main"}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | jq -c '.hookSpecificOutput.permissionDecision // "pass"'
# Expected: "deny"

# Test 9: git status (should pass)
echo '{"tool_input":{"command":"git status"}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | jq -c '. // "null"'
# Expected: "null" (pass through)

# Test 10: force push to feature (should ask)
echo '{"tool_input":{"command":"git push --force origin feature"}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | jq -c '.hookSpecificOutput.permissionDecision // "pass"'
# Expected: "ask"
```

**Understanding Output:**

- `"deny"` - Command blocked, skill enforcement or safety check triggered
- `"ask"` - User permission required (soft safety check)
- `"null"` - Command passes through (no hook action)
- `{hookSpecificOutput: {...}}` - Full hook response with context/warnings

**Plugin Validation:**

```bash
claude plugin validate ./git
```

**Markdown Linting:**

```bash
npx markdownlint-cli2 --config ${CLAUDE_PROJECT_DIR}/.markdownlint-cli2.jsonc "git/**/*.md"
```

## Technical Notes

### Router Implementation

- **Architecture:** Pure jq for all command routing and logic
- **Command routing:** jq `cmd_match()` helper that matches commands at start or after `&&`/`;` with optional override prefix
- **Helper functions:** jq `def` for reusable patterns (cmd_match, force flags, dry-run flags, mainline detection)
- **Override detection:** Simple boolean check for `GIT_WORKFLOWS_OVERRIDE=1` anywhere in command
- **Routing order:** Safety checks first (always enforced), then skill enforcement (only if no override)
- **Mainline caching:** Bash checks `CLAUDE_MAINLINE_BRANCH` before calling detect script
- **No-op return:** jq `null` for non-matching commands
- **Portability:** Consistent behavior across Bash 3.2 (macOS) and Bash 5.3+ (modern systems)

### jq Patterns

- Use `(.a == .b | not)` instead of `.a != .b` - bash escapes `!` as `\!`
- `cmd_match()` helper: `def cmd_match($p): test("(^|&&|;)\\s*(GIT_WORKFLOWS_OVERRIDE=1\\s+)?" + $p);`
  - Matches command at start (`^`) or after chaining operators (`&&`, `;`)
  - Handles optional `GIT_WORKFLOWS_OVERRIDE=1` prefix
  - Works for both simple and chained commands
- Test for flags with word boundaries: `test("\\s--force|\\s-[a-zA-Z]*f")`
- Mainline detection via `${CLAUDE_PLUGIN_ROOT}/scripts/detect-mainline.sh`
- Override detection: `($cmd | test("GIT_WORKFLOWS_OVERRIDE=1")) as $has_override`

### Hook Matchers

Hook matchers are regex patterns matched against tool names:
- `Bash` - matches the Bash tool exactly
- `Bash|Write` - matches Bash or Write tools
- `mcp__plugin_.*` - matches any MCP plugin tool
- See [Hook documentation](https://code.claude.com/docs/en/hooks) for official syntax
