---
name: git:commit
description: This skill should be used when the user asks to "commit changes", "make a commit", "commit files", "create a commit", "git commit", or mentions committing code. Enhances commits with mainline protection, conventional commits detection, and pre-commit verification.
---

# Git Commit Creation

Enhance commit creation with mainline branch protection, commit style detection, and pre-commit verification steps.

## Quick Reference

**Workflow:**
1. ✓ [Check if on mainline](#1-pre-flight-checks) (if yes, create branch first)
2. ✓ [Verify changes exist](#1-pre-flight-checks) (use dynamic context)
3. ✓ [Detect commit style](#2-detect-commit-style) (detect-conventions skill)
4. ✓ [Run pre-commit checks](#3-run-pre-commit-verification) (CLAUDE.md verification)
5. ✓ [Stage specific files](#4-stage-files) (check for sensitive files, avoid `git add -A`)
6. ✓ [Craft commit message](#5-craft-commit-message) (conventional commits if detected)
7. ✓ [Create and verify commit](#6-create-commit)

**Commit message format:**
- With conventional commits: `type(scope): description`
- Without: `Imperative description`
- Max 50 chars subject, 72 chars body

**Commit types:** feat, fix, docs, style, refactor, perf, test, chore, build, ci

**Sections:** [Current Git State](#current-git-state) • [Core Workflow](#core-workflow) • [Conventional Commits](#conventional-commits-reference) • [Examples](#examples)

## Current Git State

- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Mainline branch: !`${CLAUDE_PLUGIN_ROOT}/skills/commit/scripts/detect-mainline.sh`
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

Follow these steps when the user requests creating a commit:

### 1. Pre-Flight Checks

**Check current branch:**

Use the git state from dynamic context above to check if on mainline branch.

**If on mainline branch:**
1. Warn user: "You're on the `{mainline}` branch. Creating a feature branch first is recommended."
2. Invoke `/git:branch` skill using the Skill tool
3. After branch created, continue with commit process

**Verify there are changes to commit:**

Use the git state from dynamic context above. Check the "Status" and "Staged changes" to see if there are any changes to commit.

**If no changes exist:**

Inform the user there's nothing to commit and exit early.

### 2. Detect Commit Style

Invoke the `detect-conventions` skill to determine commit style (conventional commits or standard).

### 3. Run Pre-Commit Verification

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

**Example:**
```bash
# CLAUDE.md says: "Before committing, run: npm test"
npm test

if [ $? -ne 0 ]; then
  # Tests failed - ask user before proceeding
fi
```

**If pre-commit checks fail:**

Present options to user:
1. Fix the failing tests/checks
2. Skip tests (not recommended)
3. Commit anyway with `--no-verify` (only if user explicitly approves)

### 4. Stage Files

**Determine what to stage:**

Prefer staging specific files by name rather than using `git add -A` or `git add .`:
- Safer (avoids accidentally staging sensitive files)
- More intentional
- Clearer what's being committed

**Check for sensitive files:**

Warn before staging:
- `.env`, `.env.*` files
- Files with `credentials`, `secrets`, `password` in name
- `id_rsa`, `.pem`, `.key` files
- `config.local.*` files

**Stage selected files:**

```bash
git add file1.js file2.js file3.js
```

### 5. Craft Commit Message

Use results from the `detect-conventions` skill to determine commit message format.

## Conventional Commits Reference

**If conventional commits are used, follow this format:** `<type>(<scope>): <description>`

| Type | Description |
|------|-------------|
| feat | New feature |
| fix | Bug fix |
| docs | Documentation |
| style | Code style (no logic change) |
| refactor | Code restructuring |
| perf | Performance improvement |
| test | Adding tests |
| chore | Maintenance |
| build | Build system changes |
| ci | CI/CD changes |

**Subject:** Imperative mood, lowercase, no period, max 50 chars

**Example:**
```
feat(auth): add OAuth2 login support

Implements OAuth2 authentication with Google and GitHub providers.
Includes token refresh and session management.

Closes #123
```

**If conventional commits NOT used:**

Use clear, descriptive messages:
- Start with imperative verb (Add, Fix, Update, Remove)
- Be specific about what changed
- Explain why if not obvious

**Example:**
```
Add user authentication with OAuth2

Allows users to log in with Google or GitHub accounts.
```

**Message guidelines:**
- Subject line: Max 50 characters, imperative mood, no period
- Body: Wrap at 72 characters, explain what and why
- Footer: Reference issues, breaking changes

### 6. Create Commit

**Hand off to Claude's built-in commit workflow:**

At this point, let Claude's default commit capabilities handle:
- Finalizing message
- Creating the commit
- Co-authored-by attribution

### 7. Verify Success

Report success to user with commit hash and message. If there was a problem, report the error.

## Examples

### Example 1: Commit on Main Branch (Redirects to Branch Creation)

**User request:** "Commit the authentication changes"

**Steps:**
1. Pre-flight: On `main` branch (is mainline)
2. Warn: "You're on `main`. Creating feature branch first."
3. Invoke `/git:branch` skill → Creates `feat/authentication`
4. Continue on new branch, verify changes exist ✓
5. Detect commit style: Conventional commits detected
6. No pre-commit checks in CLAUDE.md
7. Stage files: `git add src/auth.js src/auth.test.js`
8. Craft message: `feat(auth): add user authentication`
9. Create commit and verify

### Example 2: Bug Fix with Pre-Commit Checks

**User request:** "Commit the login fix"

**Steps:**
1. Pre-flight: On `fix/login-bug` (not mainline) ✓, changes exist ✓
2. Detect commit style: Conventional commits detected
3. Check CLAUDE.md: Says "run: npm test before committing"
4. Run verification: `npm test` → Pass ✓
5. Stage: `git add src/login.js`
6. Craft message: `fix(auth): resolve token expiry issue`
7. Create commit and verify

### Example 3: Simple Commit without Conventional Commits

**User request:** "Commit my changes"

**Steps:**
1. Pre-flight: On `update-readme` (not mainline) ✓, changes exist ✓
2. Detect commit style: No conventional commits
3. No pre-commit checks in CLAUDE.md
4. Stage: `git add README.md`
5. Craft message: `Update installation instructions`
6. Create commit and verify

## Task Coordination

At workflow start:
- Create coordination task with TaskCreate:
  - subject: "Create git commit"
  - activeForm: "Creating git commit"
  - metadata: `{ workflow: "commit", branch: "<current-branch>", startedAt: "<timestamp>" }`

During workflow:
- Update task metadata as conventions are detected (from detect-conventions skill)
- Add metadata on errors or user decisions

At workflow end:
- Update task status to completed
- Add result metadata: `{ result: { commitSha: "<sha>", message: "<summary>" } }`

## Integration with Other Skills

**This skill invokes:**
- **`/git:branch`** - When user tries to commit on mainline

**This skill is invoked by:**
- **`/git:pr`** - When creating PR with uncommitted changes
