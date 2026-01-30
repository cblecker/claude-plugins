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
2. Title and brief description
3. **Quick Reference** (workflow, key info, navigation links)
4. Current Git State (dynamic context)
5. Git Safety (if applicable)
6. Core Workflow (numbered steps)
7. Reference sections (tables, examples)
8. Examples
9. Integration with Other Skills

**Quick Reference should include:**
- Workflow checklist with links to sections
- Key reference info (commit types, branch prefixes, etc.)
- Navigation: `[Section](#anchor) • [Section](#anchor)`

## Hooks Architecture

### Router-Based Hook Pattern

Single router script (`scripts/git-bash-router.sh`) handles all git-related Bash commands:

**Architecture:**
```
Bash tool use → hooks.json matcher: "Bash" → router script (pure jq)
                                                    ↓
                                          if startswith("git push")
                                          elif startswith("git commit")
                                          else null
```

**Performance optimization:**
1. **Pure jq implementation** for consistent behavior across systems
2. **Helper functions** (def) for reusable patterns (force flags, dry-run, mainline)
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
- Use `(.a == .b | not)` instead of `.a != .b` in jq (bash escapes `!` as `\!`)
- Return `null` for no-op (hook passes through)
- Pure jq implementation ensures consistent behavior across Bash versions
- See [Hook documentation](https://code.claude.com/docs/en/hooks) for matcher syntax

### Hook Categories

| Category | Decision | Purpose |
|----------|----------|---------|
| Safety (hard) | `deny` | Block dangerous operations unconditionally |
| Safety (soft) | `ask` | Require explicit user permission |
| Suggestion | `additionalContext` | Nudge toward better workflows |
| Warning | `additionalContext` | Alert about potentially risky operations |

**Examples:**
- Force push to mainline → `deny` (never allowed)
- Force push to feature branch → `ask` (requires permission)
- `git commit` → `additionalContext` (suggest using `/git:commit`)
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

Moved Quick Reference to top with section links provides:
- Instant overview of workflow
- Easy navigation via anchor links
- Better first impression for users

**Pattern:** Always include workflow checklist with links to detailed sections.

### Haiku for Detection is Fast

The `detect-conventions` skill uses haiku model for detection:
- Faster than sonnet for simple analysis tasks
- Lower cost
- Sufficient for pattern matching and config checking

**Guideline:** Use haiku for detection/analysis subagents, sonnet for generation/reasoning.

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
- Force push tests (deny to mainline, ask elsewhere)
- Skill suggestion tests
- Warning tests (reset --hard, clean -f, rebase)
- MCP tests (fork detection)

**Pattern:** Document test cases in README alongside hook descriptions.
