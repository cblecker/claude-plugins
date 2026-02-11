---
name: pr
description: Enhanced pull request creation with fork detection, template discovery and proper base branch targeting
---

## Quick Reference

**Workflow:**

1. Check uncommitted changes (commit if needed)
2. Verify not on mainline (must be on feature branch)
3. Detect fork setup (origin vs upstream)
4. Find PR templates
5. Push branch (if not already pushed)
6. Create PR using GitHub MCP tools

## Current Git State

- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Mainline branch: !`${CLAUDE_PLUGIN_ROOT}/skills/pr/scripts/detect-mainline.sh`
- Has uncommitted changes: !`git diff-index --quiet HEAD -- 2>/dev/null && echo "no" || echo "yes"`
- Remotes: !`git remote -v`
- Commits since mainline: !`mainline=$(${CLAUDE_PLUGIN_ROOT}/skills/pr/scripts/detect-mainline.sh); git log ${mainline}..HEAD --oneline 2>/dev/null || echo "unable to determine"`

## Core Workflow

### 1. Pre-Flight Checks

**Uncommitted changes:** If present, ask user whether to commit first. If yes, invoke the `commit` skill via the Skill tool, then re-fetch current branch and uncommitted status (the commit skill may have created a new branch). If no, stop -- user must commit or stash before creating a PR.

**Mainline protection:** If current branch equals mainline, stop and instruct the user to create a feature branch first. This check runs after any commit (since branch may have changed) and when the working tree is already clean.

### 2. Detect Fork Setup

Use remotes from dynamic context above.

**Fork detection:**

If both `origin` and `upstream` remotes exist, this is a fork setup:

- Push to: `origin` (your fork)
- PR targets: `upstream` (original repo)
- head format: `username:branch`

**Direct repository:**

If only `origin` remote exists:

- Push to: `origin`
- PR targets: `origin`
- head format: `branch`

**Extract owner/repo from remote URLs** for use with GitHub MCP tools.

### 3. Find PR Templates

Search for PR templates in common locations:

- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/pull_request_template.md`
- `.github/PULL_REQUEST_TEMPLATE/*.md`
- `docs/PULL_REQUEST_TEMPLATE.md`
- `PULL_REQUEST_TEMPLATE.md`

**If template found:**

1. Read template content
2. Use template structure for PR description
3. Fill in relevant sections based on changes

**If multiple templates:**

- Templates may be categorized (bug_fix.md, feature.md, etc.)
- Ask user which template applies

### 4. Push Branch (if needed)

Check if branch exists on remote and is up to date. If not pushed or outdated, push with `git push -u $push_remote $current_branch`. For fork setup, verify pushing to `origin` (your fork), NOT `upstream`.

**Note:** Git push commands do not require the `GIT_WORKFLOWS_OVERRIDE=1` prefix as they are not blocked by skill enforcement (only safety-checked).

### 5. Create Pull Request

**Prefer GitHub MCP tools over gh CLI:**

Use `mcp__plugin_github_github__create_pull_request` with fields: owner (upstream if fork), repo, title, head (user:branch for forks), base (mainline), body (PR description).

**If using gh CLI fallback:** Prefix `gh pr create` commands with `GIT_WORKFLOWS_OVERRIDE=1` to bypass the PreToolUse hook that enforces skill usage. For example:

```bash
GIT_WORKFLOWS_OVERRIDE=1 gh pr create --title "feat: add user auth" --body "..."
```

**For fork PRs:**

- `head` format: `your-username:branch-name`
- `base` repository: upstream repository
- Verify you have permission to create PR to upstream

**For direct repository PRs:**

- `head` format: `branch-name`
- `base` repository: same repository

**PR description structure:**

If template found, follow it. Otherwise include: Summary (3-5 bullet overview), Changes (detailed list), Testing (how tested), Related Issues (Closes #num).

### 6. Return PR URL

Report success to user, provide PR URL, and mention any next steps (request reviewers, run CI, etc.).
