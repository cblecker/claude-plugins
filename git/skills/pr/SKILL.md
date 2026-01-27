---
name: git:pr
description: This skill should be used when the user asks to "create a pull request", "make a PR", "open a pull request", "create PR", "submit for review", or mentions creating a GitHub/GitLab pull request or merge request. Enhances PR creation with fork detection and template discovery.
---

# Git Pull Request Creation

Enhance pull request creation with automatic fork detection, PR template discovery, and proper base branch targeting.

## Quick Reference

**Workflow:**
1. ✓ [Check uncommitted changes](#1-pre-flight-checks) (commit if needed)
2. ✓ [Verify not on mainline](#1-pre-flight-checks) (must be on feature branch)
3. ✓ [Detect fork setup](#2-detect-fork-setup) (origin vs upstream)
4. ✓ [Find PR templates](#4-find-pr-templates)
5. ✓ [Push branch](#5-push-branch-if-needed) (if not already pushed)
6. ✓ [Create PR](#6-create-pull-request) using GitHub MCP tools

**Sections:** [Current Git State](#current-git-state) • [Core Workflow](#core-workflow) • [Examples](#examples)

## Current Git State

- Current branch: !`git rev-parse --abbrev-ref HEAD`
- Mainline branch: !`${CLAUDE_PLUGIN_ROOT}/skills/pr/scripts/detect-mainline.sh`
- Has uncommitted changes: !`git diff-index --quiet HEAD -- 2>/dev/null && echo "no" || echo "yes"`
- Remotes: !`git remote -v`
- Commits since mainline: !`mainline=$(${CLAUDE_PLUGIN_ROOT}/skills/pr/scripts/detect-mainline.sh); git log ${mainline}..HEAD --oneline 2>/dev/null || echo "unable to determine"`

## Core Workflow

Follow these steps when the user requests PR creation:

### 1. Pre-Flight Checks

Use git state from dynamic context above.

**Verify branch is not mainline:**

If current branch equals mainline branch, error and suggest creating a feature branch first.

**If uncommitted changes exist:**
1. Ask user: "You have uncommitted changes. Would you like to commit them first?"
2. If yes, invoke `/git:commit` skill using the Skill tool
3. After commit succeeds, continue with PR process

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

### 3. Gather Context

**Review commits:**

Use commits since mainline from dynamic context above to understand what will be in the PR.

**Check if branch is pushed:**

```bash
# Check if current branch exists on remote
if git ls-remote --heads $push_remote $current_branch | grep -q .; then
  echo "Branch exists on remote"

  # Check if up to date
  local_sha=$(git rev-parse HEAD)
  remote_sha=$(git rev-parse $push_remote/$current_branch)

  if [ "$local_sha" != "$remote_sha" ]; then
    echo "Local branch ahead of remote - need to push"
  fi
else
  echo "Branch not on remote - need to push"
fi
```

### 4. Find PR Templates

**Search for PR templates:**

```bash
# Common PR template locations
templates=(
  ".github/PULL_REQUEST_TEMPLATE.md"
  ".github/pull_request_template.md"
  ".github/PULL_REQUEST_TEMPLATE/*.md"
  "docs/PULL_REQUEST_TEMPLATE.md"
  "PULL_REQUEST_TEMPLATE.md"
)

# Check which exist
for template in "${templates[@]}"; do
  if [ -f "$template" ] || ls $template 2>/dev/null; then
    echo "Found template: $template"
  fi
done
```

**If template found:**
1. Read template content
2. Use template structure for PR description
3. Fill in relevant sections based on changes

**If multiple templates:**
- Check `.github/PULL_REQUEST_TEMPLATE/` directory
- Templates may be categorized (bug_fix.md, feature.md, etc.)
- Ask user which template applies

### 5. Push Branch (if needed)

**If branch not pushed or outdated:**

```bash
# Push with upstream tracking
git push -u $push_remote $current_branch
```

**If fork setup:**

Verify pushing to correct remote:
- Should push to `origin` (your fork)
- NOT to `upstream` (original repo)

### 6. Create Pull Request

**Prefer GitHub MCP tools over gh CLI:**

Use `mcp__plugin_github_github__create_pull_request` tool:

```
owner: {pr_base_owner}  # upstream owner if fork, else origin owner
repo: {pr_base_repo}     # repository name
title: {pr_title}        # Descriptive title
head: {your_username}:{current_branch}  # If fork: user:branch
base: {mainline}         # Target branch (main/master)
body: {pr_description}   # PR description with template
```

**For fork PRs:**
- `head` format: `your-username:branch-name`
- `base` repository: upstream repository
- Verify you have permission to create PR to upstream

**For direct repository PRs:**
- `head` format: `branch-name`
- `base` repository: same repository

**PR description structure:**

If template found, follow it. Otherwise use:

```markdown
## Summary
- Brief overview of changes (3-5 bullet points)

## Changes
- Detailed list of modifications
- What was added/removed/changed

## Testing
- How changes were tested
- Test cases covered

## Related Issues
Closes #{issue_number}
```

### 7. Return PR URL

After PR created:
1. Report success to user
2. Provide PR URL for viewing
3. Mention any next steps (request reviewers, run CI, etc.)

## Examples

### Example 1: Create PR from Fork

**User request:** "Create a pull request for my authentication changes"

**Steps:**
1. Check uncommitted: None ✓
2. Current branch: `feat/auth`, not mainline ✓
3. Detect fork: Has origin + upstream → Yes, is fork
4. Push target: `origin`, PR base: `upstream`
5. Check commits: 3 commits since `main`
6. Find template: Found `.github/PULL_REQUEST_TEMPLATE.md`
7. Push: `git push -u origin feat/auth`
8. Create PR using GitHub MCP:
   - owner: `upstream-org`
   - repo: `project`
   - head: `myusername:feat/auth`
   - base: `main`
   - body: Template filled with changes
9. Return: "PR created: https://github.com/upstream-org/project/pull/123"

### Example 2: PR with Uncommitted Changes

**User request:** "Open a PR for the bug fix"

**Steps:**
1. Check uncommitted: Has unstaged changes in `login.js`
2. Ask: "You have uncommitted changes. Commit them first?"
3. User: "Yes"
4. Invoke `/git:commit` skill → Creates commit
5. Detect fork: No (single remote)
6. Find template: None found
7. Push: `git push -u origin fix/login-bug`
8. Create PR using GitHub MCP:
   - owner: `my-org`
   - repo: `my-project`
   - head: `fix/login-bug`
   - base: `main`
   - body: Auto-generated from commits
9. Return PR URL

### Example 3: PR to Non-Main Branch

**User request:** "Create PR targeting the develop branch"

**Steps:**
1. Pre-flight checks: Pass ✓
2. Detect fork: No
3. Base branch: User specified `develop` (override mainline)
4. Push branch
5. Create PR with base: `develop`
6. Return PR URL

## Integration with Other Skills

**This skill invokes:**
- **`/git:commit`** - When uncommitted changes exist

**This skill is invoked by:**
- Users directly when ready to create PR
