# Git Plugin

## Architecture

### Dynamic Context Injection

Use [dynamic context injection](https://code.claude.com/docs/en/skills#inject-dynamic-context) to pre-fetch information where possible. Place the dynamic context section after Quick Reference, before Core Workflow.

### Skill Structure

**Standardized sections (in order):**

1. YAML frontmatter (name, description, version)
2. **Quick Reference** (workflow, key info)
3. Current Git State (dynamic context)
4. Git Safety (if applicable)
5. Core Workflow (numbered steps)
6. Reference sections (tables, examples)
7. Integration with Other Skills

**Quick Reference should include:**

- Workflow checklist
- Key reference info (commit types, branch prefixes, etc.)

### Shell Scripts for Detection

The `detect-conventions.sh` and `detect-mainline.sh` scripts use bash for detection:

- Faster than subagents for simple analysis tasks
- Lower cost
- Sufficient for pattern matching and config checking
- Cached results for session reuse

**Guideline:** Use shell scripts for detection/analysis when possible, subagents for complex reasoning.

### Symlinks for Code Reuse

Symlinks allow:

- Single canonical implementation
- Per-skill permission scoping (each skill's scripts/ directory)
- Easy updates (change one file, all symlinks benefit)

**Pattern:** Canonical in `scripts/`, symlinks in `skills/*/scripts/`.

## Hooks Architecture

### PreToolUse Router-Based Enforcement Pattern

Single router script (`scripts/git-bash-router.py`) handles both safety checks and skill enforcement for git-related Bash commands:

**Architecture:**

```text
Bash tool use → hooks.json matcher: "Bash" → router script (Python)
                                                    ↓
                                    1. Check for GIT_WORKFLOWS_OVERRIDE=1
                                    2. Safety checks (always applied)
                                    3. Skill enforcement (if no override)
                                                    ↓
                                          deny | ask | additionalContext | null
```

**Routing Order:**

1. **Override detection:** Check for `GIT_WORKFLOWS_OVERRIDE=1` anywhere in command
2. **Safety checks** (always enforced, even with override):
   - Force push to mainline → deny
   - Force push elsewhere → ask
   - `git reset --hard` → warn
   - `git clean -f` without `-n` → warn
   - `git rebase` onto mainline → warn
3. **Skill enforcement** (only when override not present):
   - `git commit` → deny, suggest `git:commit`
   - `git checkout -b` / `git switch -c` → deny, suggest `git:branch`
   - `gh pr create` → deny, suggest `git:pr`

**Override Mechanism:**

- Skills instruct Claude to prefix commands with `GIT_WORKFLOWS_OVERRIDE=1`
- Example: `GIT_WORKFLOWS_OVERRIDE=1 git commit -m "feat: add auth"`
- Override bypasses skill enforcement only, not safety checks
- Auditable and visible in command string

**Why PreToolUse:** Fires on every tool call regardless of origin (user-initiated or autonomous). Catches both direct user commands and autonomous multi-step operations.

**Performance:** ~30-60ms per Bash tool use vs ~400ms for multiple separate hooks. Single Python process handles all routing and logic.

**Pattern:**

```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.py",
    "timeout": 5
  }]
}
```

**Technical notes:**

- Matchers are regex patterns matched against tool names
- `cmd_match()` helper: uses `re.search()` to match commands at start or after `&&`/`;` with optional override prefix
- Return `null` for no-op (hook passes through)
- Error handling: any exception outputs `null` and exits 0 (degrade to passthrough)
- Python 3 stdlib only (`json`, `re`, `subprocess`, `os`, `sys`)
- See [Hook documentation](https://code.claude.com/docs/en/hooks) for matcher syntax

### Hook Categories

| Category | Event | Decision | Purpose |
|----------|-------|----------|---------|
| Skill Enforcement | `PreToolUse` | `deny` | Block direct git commands, enforce skill usage |
| Safety (hard) | `PreToolUse` | `deny` | Block dangerous operations unconditionally |
| Safety (soft) | `PreToolUse` | `ask` | Require explicit user permission |
| Warning | `PreToolUse` | `additionalContext` | Alert about potentially risky operations |

**Examples:**

- `git commit -m "msg"` → `deny`, suggest `git:commit` skill
- `GIT_WORKFLOWS_OVERRIDE=1 git commit -m "msg"` → pass through (skill-authorized)
- Force push to mainline → `deny` (never allowed, even with override)
- Force push to feature branch → `ask` (requires permission)
- `git reset --hard` → `additionalContext` (warn about data loss)

### Hook Documentation

Comprehensive `hooks/README.md` includes:

- Intent, logic, and rationale for each hook
- Test plan with expected outcomes
- Technical implementation notes

## Workflow Patterns

### Pre-Flight Checks First

**Pattern:** All skills should check prerequisites before doing detection work.

**Correct order:**

1. Check uncommitted changes (warn)
2. Confirm base branch / verify not on mainline
3. Detect conventions (invoke subagent)
4. Generate names / messages
5. Execute operation

**Why:** Avoids wasted work if user needs to address pre-flight issues.

### Safety Before Workflow

Place safety rules section before Core Workflow so they're immediately visible.

**Structure:**

```markdown
## Quick Reference
## Current Git State
## Git Safety  ← Place here
## Core Workflow
```

## Maintenance

### Testing Hooks

See `git/hooks/README.md` for comprehensive test plan covering:

- Skill enforcement tests (deny without override, pass with override)
- Chained command tests (enforcement and safety in chains)
- Force push tests (deny to mainline, ask elsewhere)
- Override with safety tests (override doesn't bypass safety)
- Warning tests (reset --hard, clean -f, rebase)
- MCP tests (fork detection)

**Running Tests:**

Set environment variables and pipe JSON to the router script:

```bash
export CLAUDE_PLUGIN_ROOT=<path-to-git-plugin>
export CLAUDE_MAINLINE_BRANCH=main
echo '{"tool_input":{"command":"git commit -m \"test\""}}' | \
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.py
```

Full test suite available in `git/hooks/README.md` under "Running Tests" section.
