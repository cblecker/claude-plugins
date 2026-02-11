---
name: commit
description: Enhanced git commit with mainline protection, conventional commits detection, and pre-commit verification
---

## Quick Reference

**Workflow:**

1. Check if on mainline (if yes, create branch unless explicitly allowed)
2. Verify changes exist (use dynamic context)
3. Run pre-commit checks (CLAUDE.md verification)
4. Stage specific files (check for sensitive files, avoid `git add -A`)
5. Craft commit message (conventional commits if detected)
6. Create and verify commit

**Commit types:** feat, fix, docs, style, refactor, perf, test, chore, build, ci

## Current Git State

- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Mainline branch: !`${CLAUDE_PLUGIN_ROOT}/skills/commit/scripts/detect-mainline.sh`
- Detect conventional commits: !`${CLAUDE_PLUGIN_ROOT}/skills/commit/scripts/detect-conventions.sh`
- Status: !`git status --short`
- Staged changes: !`git diff --cached --stat`
- Recent commits: !`git log -5 --pretty=format:"%h %s"`

## Git Safety

Safety rules enforced by this skill:

- Never commit directly to mainline (redirect to branch creation)
- Check for sensitive files before staging
- Run pre-commit verification if specified
- Use specific file names rather than `git add -A`

## Core Workflow

All steps reference the dynamic context above for current state.

### 1. Pre-Flight Checks

**Check current branch:**

**If on mainline branch:**

Check if the user's prompt or project CLAUDE.md explicitly allows committing directly to mainline (e.g., "commit to main", "no feature branch", "allow mainline commits"). If so, skip branch creation and proceed with the commit.

Otherwise, automatically create a feature branch:

1. Inform user: "You're on the `{mainline}` branch. Creating a feature branch."
2. Invoke the `branch` skill using the Skill tool
3. After branch created, continue with commit process

**Verify there are changes to commit:**

Check the "Status" and "Staged changes" to see if there are any changes to commit. If no changes exist, inform the user there's nothing to commit and exit early.

### 2. Run Pre-Commit Verification

**Check CLAUDE.md for pre-commit steps:**

Read project CLAUDE.md and look for sections like:

```markdown
## Git Workflow

- Before committing, run: `npm test` and `npm run lint`
```

**If CLAUDE.md specifies pre-commit steps:**

1. Execute each command specified
2. Verify all pass successfully
3. If any fail, report to user and ask how to proceed
4. Do NOT commit if verification fails without user approval

**If pre-commit checks fail:**

Present options to user:

1. Fix the failing tests/checks
2. Skip tests (not recommended)
3. Commit anyway with `--no-verify` (only if user explicitly approves)

### 3. Stage Files

Prefer staging specific files by name rather than using `git add -A` or `git add .`. Warn before staging sensitive files (`.env`, credentials, secrets, `.pem`, `.key`, `config.local.*` files).

### 4. Craft Commit Message

**If conventional commits are detected (from dynamic context):**

Follow format `<type>(<scope>): <description>`. See [conventional-commits.md](./conventional-commits.md) for full reference.

**If conventional commits NOT used:**

Use clear, descriptive messages starting with imperative verb (Add, Fix, Update, Remove). Be specific about what changed.

### 5. Create Commit and Verify Success

Use Claude's built-in commit workflow to finalize the message, create the commit, and add co-authored-by attribution.

**IMPORTANT:** Prefix git commit commands with `GIT_WORKFLOWS_OVERRIDE=1` to bypass the PreToolUse hook that enforces skill usage. For example:

```bash
GIT_WORKFLOWS_OVERRIDE=1 git commit -m "feat: add user authentication"
```

Report success with commit hash and message, or report any errors.
