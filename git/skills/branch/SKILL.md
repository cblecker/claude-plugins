---
name: branch
description: Enhanced branch creation with smart naming and conventional commits detection
---

## Quick Reference

**Workflow:**

1. Check for uncommitted changes (warn if present)
2. Confirm base branch (mainline by default)
3. Detect conventions (branch naming, commit message rules)
4. Generate branch name (type/description)
5. Create and verify branch

## Current Git State

- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Mainline branch: !`${CLAUDE_PLUGIN_ROOT}/skills/branch/scripts/detect-mainline.sh`
- Detect conventional commits: !`${CLAUDE_PLUGIN_ROOT}/skills/branch/scripts/detect-conventions.sh`
- Has uncommitted changes: !`git diff-index --quiet HEAD -- 2>/dev/null && echo "no" || echo "yes"`

## Core Workflow

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

Use AskUserQuestion if the base branch is ambiguous.

### 3. Detect Conventions

Convention detection results are available from the dynamic context section above (see line 19: `detect-conventions.sh`).

The detection identifies:

- Whether the repository uses conventional commits format
- How many recent commits match the pattern

This information determines the branch naming strategy in the next step.

### 4. Generate Branch Name

**If conventional commits are detected (from dynamic context):**

Use type prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`, `build/`, `ci/`. See [conventional-commits.md](../commit/conventional-commits.md) for full reference.

**If conventional commits NOT used:**

Use simple descriptive names: `feature-description`, `bugfix-description`, `update-description`

**Naming rules:**

- Use kebab-case (lowercase with hyphens)
- Be descriptive but concise (3-5 words max)
- No special characters except hyphens and slashes
- Start with letter or type prefix

### 5. Create Branch

Execute branch creation using the confirmed base branch.

**IMPORTANT:** Prefix git branch creation commands with `GIT_WORKFLOWS_OVERRIDE=1` to bypass the PreToolUse hook that enforces skill usage. For example:

```bash
GIT_WORKFLOWS_OVERRIDE=1 git switch -c feat/user-auth main
```

### 6. Verify and Report

Verify branch was created and report success to user with branch name.
