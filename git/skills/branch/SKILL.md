---
name: git:branch
description: This skill should be used when the user asks to "create a branch", "make a new branch", "start a feature", "checkout -b", "switch -c", or mentions creating a git branch. Enhances branch creation with smart naming conventions and base branch awareness.
---

# Git Branch Creation

Enhance branch creation with automatic detection of naming conventions and intelligent base branch selection.

## Quick Reference

**Workflow:**
1. ✓ [Check for uncommitted changes](#1-check-for-uncommitted-changes) (warn if present)
2. ✓ [Confirm base branch](#2-confirm-base-branch) (mainline by default)
3. ✓ [Detect naming convention](#3-detect-naming-convention) (conventional commits)
4. ✓ [Generate branch name](#4-generate-branch-name) (type/description)
5. ✓ Create and verify branch

**Branch naming:**
- With conventional commits: `type/description` (feat/, fix/, docs/, etc.)
- Without: `description` (kebab-case)
- Always lowercase with hyphens

**Branch types:** feat, fix, docs, refactor, test, chore, build, ci

**Sections:** [Current Git State](#current-git-state) • [Core Workflow](#core-workflow) • [Branch Naming](#conventional-commits-branch-naming) • [Examples](#examples)

## Current Git State

- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Mainline branch: !`${CLAUDE_PLUGIN_ROOT}/skills/branch/scripts/detect-mainline.sh`
- Has uncommitted changes: !`git diff-index --quiet HEAD -- 2>/dev/null && echo "no" || echo "yes"`

## Core Workflow

Follow these steps when the user requests branch creation:

### 1. Check for Uncommitted Changes

Use git state from dynamic context above to check for uncommitted changes.

**If uncommitted changes exist:**

Warn user: "You have uncommitted changes. They will come with you to the new branch. Consider committing or stashing them first."

This is informational only - uncommitted changes don't prevent branch creation, but the user should be aware.

### 2. Confirm Base Branch

**Default base branch:**
- Use mainline branch from dynamic context (typically `main` or `master`)

**Alternative base branches:**
- If user is on a feature branch and wants to branch from it, use current branch
- For release workflows, may branch from `develop` or specific release branch

**Ask for confirmation if uncertain:**

Use AskUserQuestion if the base branch is ambiguous:
```
"Create branch from '{base_branch}'?"
Options: Yes / Use current branch / Specify different branch
```

### 3. Detect Naming Convention

Invoke the `detect-conventions` skill to determine branch naming style.

### 4. Generate Branch Name

Use results from the `detect-conventions` skill to generate appropriate branch name.

## Conventional Commits Branch Naming

**If conventional commits are used:**

| Type | Branch Prefix | Use For |
|------|---------------|---------|
| feat | `feat/` | New features |
| fix | `fix/` | Bug fixes |
| docs | `docs/` | Documentation |
| refactor | `refactor/` | Code refactoring |
| test | `test/` | Test additions |
| chore | `chore/` | Maintenance tasks |
| build | `build/` | Build system changes |
| ci | `ci/` | CI/CD changes |

**If conventional commits NOT used:**

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

### 5. Create Branch

Execute branch creation using the confirmed base branch:

```bash
git checkout -b {branch_name} {base_branch}
```

Or for newer git:

```bash
git switch -c {branch_name} {base_branch}
```

### 6. Verify and Report

After creation:
1. Verify branch was created: `git branch --list {branch_name}`
2. Confirm current branch: `git rev-parse --abbrev-ref HEAD`
3. Report success to user with branch name

## Examples

### Example 1: Feature Branch with Conventional Commits

**User request:** "Create a branch for adding user authentication"

**Steps:**
1. Check uncommitted changes: None ✓
2. Confirm base branch: `main` (mainline) ✓
3. Detect conventional commits: Found `commitlint.config.js` → Yes
4. Generate name: `feat/user-authentication`
5. Execute: `git checkout -b feat/user-authentication main`
6. Report: "Created branch `feat/user-authentication` from `main`"

### Example 2: Bug Fix without Conventional Commits

**User request:** "Make a branch to fix the login bug"

**Steps:**
1. Check uncommitted changes: None ✓
2. Confirm base branch: `main` ✓
3. Detect conventional commits: No config, commit history doesn't match → No
4. Generate name: `fix-login-bug`
5. Execute: `git checkout -b fix-login-bug main`
6. Report: "Created branch `fix-login-bug` from `main`"

### Example 3: Branch from Current Feature

**User request:** "Create a sub-branch for the API refactor"

**Steps:**
1. Check uncommitted changes: None ✓
2. Confirm base branch: Ask user → User confirms `feat/api-redesign` instead of `main`
3. Detect conventional commits: Yes
4. Generate name: `refactor/api-cleanup`
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

## Integration with Other Skills

This skill may be invoked by:
- **`/git:commit`** - When user tries to commit on mainline branch
- **`/git:pr`** - When preparing to create a PR and no feature branch exists
