# Git Plugin Development Notes

Development learnings and architectural decisions for the git plugin.

Key decisions:
- Use [dynamic context injection](https://code.claude.com/docs/en/skills#inject-dynamic-context) to pre-fetch information where possible.
- Place dynamic context section after Quick Reference, before Core Workflow.

## Architecture

### Dynamic Context Injection

Use [dynamic context injection](https://code.claude.com/docs/en/skills#inject-dynamic-context) to pre-fetch information where possible.

Place dynamic context section after Quick Reference, before Core Workflow.

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

## Hooks Architecture

### PreToolUse Router-Based Enforcement Pattern

Single router script (`scripts/git-bash-router.sh`) handles both safety checks and skill enforcement for git-related Bash commands:

**Architecture:**
```
Bash tool use → hooks.json matcher: "Bash" → router script (pure jq)
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

**Performance optimization:**
1. **Pure jq implementation** for consistent behavior across systems
2. **cmd_match() helper** handles start/chained commands and optional override prefix
3. **Cached mainline** via `CLAUDE_MAINLINE_BRANCH` environment variable
4. **Single jq process** for all routing and logic

**Result:** ~15-20ms per Bash tool use vs ~400ms for multiple separate jq hooks.

**Portability:** Pure jq avoids Bash 3.2 (macOS) vs Bash 5.3+ inconsistencies with stdin handling.

**Pattern:**
```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh",
    "timeout": 5
  }]
}
```

**Technical notes:**
- Matchers are regex patterns matched against tool names
- `cmd_match()` helper: matches commands at start or after `&&`/`;` with optional override prefix
- Use `(.a == .b | not)` instead of `.a != .b` in jq (bash escapes `!` as `\!`)
- Return `null` for no-op (hook passes through)
- Pure jq implementation ensures consistent behavior across Bash versions
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

**Benefit:** Makes hooks maintainable and testable without diving into JSON.

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

## Development Learnings

### Dynamic Context Reduces Token Usage

Before: Skills executed 3-5 git commands during workflow
After: Dynamic context pre-fetches at invocation time

**Measurement:** ~50% reduction in git command execution during skill run.

### Quick Reference Improves Navigation

Moved Quick Reference to top provides:
- Instant overview of workflow
- Better first impression for users

**Pattern:** Always include workflow checklist.

### Shell Scripts for Detection

The `detect-conventions.sh` and `detect-mainline.sh` scripts use bash for detection:
- Faster than subagents for simple analysis tasks
- Lower cost
- Sufficient for pattern matching and config checking
- Cached results for session reuse

**Guideline:** Use shell scripts for detection/analysis when possible, subagents for complex reasoning.

### Router Pattern Beats Multiple Hooks

Initial implementation used 8 separate hook entries with individual jq processes.
Router pattern uses single entry with pure jq for all routing and logic.

**Performance:** Router responds in ~15-20ms vs ~400ms for multiple jq processes.

**Pattern:** Pure jq for portability and consistency across systems. Acceptable performance tradeoff for reliable behavior.

### Symlinks for Code Reuse with Permissions

Symlinks allow:
- Single canonical implementation
- Per-skill permission scoping (each skill's scripts/ directory)
- Easy updates (change one file, all symlinks benefit)

**Pattern:** Canonical in `scripts/`, symlinks in `skills/*/scripts/`.

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
  ${CLAUDE_PLUGIN_ROOT}/scripts/git-bash-router.sh | \
  jq -c '.hookSpecificOutput.permissionDecision // "pass"'
```

Full test suite available in `git/hooks/README.md` under "Running Tests" section.

**Pattern:** Document test cases in README alongside hook descriptions.
