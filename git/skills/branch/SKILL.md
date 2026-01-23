---
name: git:branch
description: This skill should be used when the user asks to "create a branch", "make a new branch", "start a feature", "checkout -b", "switch -c", or mentions creating a git branch. Enhances branch creation with smart naming conventions and base branch awareness.
version: 0.1.0
---

# Git Branch Creation

Enhance branch creation with automatic detection of naming conventions and intelligent base branch selection.

## When to Use This Skill

Use this skill when creating new git branches. It provides:
- Smart branch naming with conventional commit prefix detection
- Automatic mainline branch identification
- Branch name validation
- Base branch selection guidance

## Core Workflow

Follow these steps when the user requests branch creation:

### 1. Gather Context

**Detect conventional commits:**

Check if the repository uses conventional commits by:
1. Looking for config files: `commitlint.config.js`, `.commitlintrc*`, or `package.json` with commitlint
2. Analyzing last 10 commits: `git log -10 --pretty=format:%s` and checking if 60%+ match pattern `^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?:`
3. Checking CLAUDE.md for explicit mention of conventional commits

See `reference/conventional-commits.md` for detailed detection logic.

**Identify current branch and mainline:**

1. Get current branch: `git rev-parse --abbrev-ref HEAD`
2. Detect mainline branch:
   - Primary: `git ls-remote --symref origin HEAD | grep "^ref:" | awk '{print $2}' | sed 's|refs/heads/||'`
   - Fallback: Check for `main` or `master` locally
   - Override: Check CLAUDE.md for explicit mainline configuration

See `reference/mainline-detection.md` for detailed detection logic.

### 2. Generate Branch Name

**If conventional commits detected:**

Suggest branch names with type prefixes:
- `feat/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation
- `refactor/description` - Code refactoring
- `test/description` - Test additions
- `chore/description` - Maintenance tasks

**If conventional commits NOT detected:**

Use simple descriptive names:
- `feature-description`
- `bugfix-description`
- `update-description`

**Naming rules:**
- Use kebab-case (lowercase with hyphens)
- Be descriptive but concise (3-5 words max)
- No special characters except hyphens and slashes
- Start with letter or type prefix

**Example transformations:**
- User intent: "add OAuth login" → `feat/oauth-login` (with CC) or `add-oauth-login` (without CC)
- User intent: "fix memory leak" → `fix/memory-leak` (with CC) or `fix-memory-leak` (without CC)

### 3. Confirm Base Branch

**Default base branch:**
- Use mainline branch detected in step 1 (typically `main` or `master`)

**Alternative base branches:**
- If user is on a feature branch and wants to branch from it, use current branch
- For release workflows, may branch from `develop` or specific release branch

**Ask for confirmation:**
Use AskUserQuestion if uncertain about base branch:
```
"Create branch '{name}' from '{base_branch}'?"
Options: Yes / Change base branch
```

### 4. Create Branch

Execute branch creation:

```bash
git checkout -b {branch_name} {base_branch}
```

Or for newer git:

```bash
git switch -c {branch_name} {base_branch}
```

### 5. Verify and Report

After creation:
1. Verify branch was created: `git branch --list {branch_name}`
2. Confirm current branch: `git rev-parse --abbrev-ref HEAD`
3. Report success to user with branch name

## CLAUDE.md Configuration

Respect CLAUDE.md overrides for:

**Conventional commits:**
```markdown
## Git Workflow
- This repo uses conventional commits
- Branch naming: type/description (e.g., feat/add-login)
```

**Mainline branch:**
```markdown
## Git Workflow
- Mainline branch: develop
```

**Custom branch patterns:**
```markdown
## Git Workflow
- Branch naming: user/type/description (e.g., john/feat/add-login)
```

**Priority:** CLAUDE.md > Auto-detection > Defaults

## Examples

### Example 1: Feature Branch with Conventional Commits

**User request:** "Create a branch for adding user authentication"

**Steps:**
1. Detect conventional commits: Found `commitlint.config.js` → Yes
2. Current branch: `main`, Mainline: `main`
3. Generate name: `feat/user-authentication`
4. Base branch: `main` (mainline)
5. Execute: `git checkout -b feat/user-authentication main`
6. Report: "Created branch `feat/user-authentication` from `main`"

### Example 2: Bug Fix without Conventional Commits

**User request:** "Make a branch to fix the login bug"

**Steps:**
1. Detect conventional commits: No config, commit history doesn't match → No
2. Current branch: `main`, Mainline: `main`
3. Generate name: `fix-login-bug`
4. Base branch: `main`
5. Execute: `git checkout -b fix-login-bug main`
6. Report: "Created branch `fix-login-bug` from `main`"

### Example 3: Branch from Current Feature

**User request:** "Create a sub-branch for the API refactor"

**Steps:**
1. Detect conventional commits: Yes
2. Current branch: `feat/api-redesign`, Mainline: `main`
3. Generate name: `refactor/api-cleanup`
4. Base branch: Ask user → Confirm using `feat/api-redesign` instead of `main`
5. Execute: `git checkout -b refactor/api-cleanup feat/api-redesign`
6. Report: "Created branch `refactor/api-cleanup` from `feat/api-redesign`"

## Error Handling

**Branch already exists:**
```bash
if git branch --list {branch_name} | grep -q .; then
  # Suggest alternative name or ask to switch to existing
fi
```

**Not in a git repository:**
```bash
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  # Report error, suggest git init
fi
```

**Uncommitted changes:**
Warn user about uncommitted changes that may conflict:
```bash
if ! git diff-index --quiet HEAD --; then
  # Warn: "You have uncommitted changes. They will come with you to the new branch."
fi
```

## Integration with Other Skills

This skill may be invoked by:
- **`/git:commit`** - When user tries to commit on mainline branch
- **`/git:pr`** - When preparing to create a PR and no feature branch exists

## Quick Reference

**Detection priorities:**
1. CLAUDE.md explicit configuration
2. Config files (commitlint, etc.)
3. Commit history analysis
4. Defaults

**Branch naming:**
- With CC: `{type}/{description}`
- Without CC: `{description}`
- Always kebab-case

**Base branch:**
- Default: Mainline (main/master/develop)
- Alternative: Current branch (if user wants sub-branch)
- Confirm with user if uncertain

## Reference Files

For detailed information:
- **`reference/conventional-commits.md`** - Convention detection and commit types
- **`reference/mainline-detection.md`** - Mainline branch identification
- **`reference/git-safety.md`** - General git safety guidelines
