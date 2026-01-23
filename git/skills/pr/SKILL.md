---
name: git:pr
description: This skill should be used when the user asks to "create a pull request", "make a PR", "open a pull request", "create PR", "submit for review", or mentions creating a GitHub/GitLab pull request or merge request. Enhances PR creation with fork detection and template discovery.
version: 0.1.0
---

# Git Pull Request Creation

Enhance pull request creation with automatic fork detection, PR template discovery, and proper base branch targeting.

## When to Use This Skill

Use this skill when creating pull requests (PRs) or merge requests. It provides:
- Fork workflow detection (origin vs upstream)
- PR template discovery and usage
- Base branch determination
- Uncommitted changes handling
- Integration with GitHub MCP tools

## Core Workflow

Follow these steps when the user requests PR creation:

### 1. Pre-Flight Checks

**Check for uncommitted changes:**

```bash
# Check for staged or unstaged changes
if ! git diff-index --quiet HEAD --; then
  # Has uncommitted changes
  echo "You have uncommitted changes"
fi
```

**If uncommitted changes exist:**
1. Ask user: "You have uncommitted changes. Would you like to commit them first?"
2. If yes, invoke `/git:commit` skill using the Skill tool
3. After commit succeeds, continue with PR process

**Verify branch is not mainline:**

```bash
current_branch=$(git rev-parse --abbrev-ref HEAD)
mainline=$(detect_mainline_branch)

if [ "$current_branch" = "$mainline" ]; then
  echo "ERROR: Cannot create PR from mainline branch"
  echo "Create a feature branch first"
  exit 1
fi
```

### 2. Detect Fork Setup

**Check remote configuration:**

```bash
# Check if both origin and upstream exist
has_origin=$(git remote | grep -c "^origin$" || true)
has_upstream=$(git remote | grep -c "^upstream$" || true)

if [ "$has_origin" -eq 1 ] && [ "$has_upstream" -eq 1 ]; then
  is_fork="true"
else
  is_fork="false"
fi
```

**Extract remote information:**

```bash
# Get origin owner/repo
origin_url=$(git remote get-url origin)
origin_repo=$(echo "$origin_url" | sed -E 's|.*[:/]([^/]+/[^/]+)(\.git)?$|\1|' | sed 's/\.git$//')

# Get upstream owner/repo (if fork)
if [ "$is_fork" = "true" ]; then
  upstream_url=$(git remote get-url upstream)
  upstream_repo=$(echo "$upstream_url" | sed -E 's|.*[:/]([^/]+/[^/]+)(\.git)?$|\1|' | sed 's/\.git$//')
fi
```

See `reference/fork-detection.md` for detailed detection logic.

**Determine push target and PR base:**

```bash
if [ "$is_fork" = "true" ]; then
  push_remote="origin"        # Push to your fork
  pr_base_owner="upstream"    # PR targets upstream
  pr_base_repo="$upstream_repo"
else
  push_remote="origin"        # Push to main repo
  pr_base_owner="origin"      # PR targets same repo
  pr_base_repo="$origin_repo"
fi
```

### 3. Gather Context

**Get commit history since mainline:**

```bash
mainline=$(detect_mainline_branch)
current_branch=$(git rev-parse --abbrev-ref HEAD)

# Get commits that will be in PR
git log $mainline..HEAD --oneline

# Get full diff
git diff $mainline...HEAD
```

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

## CLAUDE.md Configuration

Respect CLAUDE.md settings:

**Fork configuration:**
```markdown
## Git Workflow
- This is a fork; push to origin, PRs target upstream
```

**PR guidelines:**
```markdown
## Git Workflow
- PR description must include: summary, testing, related issues
- Request review from: @team-lead, @reviewer
```

**Base branch:**
```markdown
## Git Workflow
- PRs target: develop (not main)
```

**Priority:** CLAUDE.md > Auto-detection > Defaults

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

## Error Handling

**On mainline branch:**
```
ERROR: Cannot create PR from mainline branch.
Create a feature branch first: git checkout -b feature-name
```

**No commits since base:**
```
ERROR: No commits found since main.
Cannot create PR with no changes.
```

**Not pushed to remote:**
```
Branch not on remote. Pushing now...
git push -u origin {branch-name}
```

**Fork push to wrong remote:**
```
WARNING: Attempting to push to upstream (original repo).
Should push to origin (your fork) instead.
```

**Permission denied:**
```
ERROR: Permission denied when creating PR.
Verify you have push access to the repository.
```

## Integration with Other Skills

**This skill invokes:**
- **`/git:commit`** - When uncommitted changes exist

**This skill is invoked by:**
- Users directly when ready to create PR

## GitHub MCP Tools vs gh CLI

**Prefer GitHub MCP tools:**
- Better integration with Claude Code
- Structured parameters
- Type-safe
- Better error handling

**Available GitHub MCP tools for PRs:**
- `create_pull_request` - Create new PR
- `update_pull_request` - Update existing PR
- `pull_request_read` - Get PR details
- `list_pull_requests` - List PRs

**When to use gh CLI:**
- GitHub MCP not available
- User explicitly requests gh CLI
- Advanced gh features not in MCP

## Quick Reference

**Pre-flight checklist:**
1. ✓ No uncommitted changes (or commit them first)
2. ✓ Not on mainline branch
3. ✓ Branch has commits since base
4. ✓ Branch is pushed to correct remote

**Fork workflow:**
- Push to: `origin` (your fork)
- PR base: `upstream` (original repo)
- head format: `username:branch`

**Direct repository:**
- Push to: `origin`
- PR base: `origin`
- head format: `branch`

**PR description:**
- Use template if found
- Include: summary, changes, testing, related issues
- Be specific and descriptive

## Reference Files

For detailed information:
- **`reference/fork-detection.md`** - Fork setup detection
- **`reference/mainline-detection.md`** - Base branch identification
- **`reference/conventional-commits.md`** - Commit analysis for PR description
- **`reference/git-safety.md`** - Safety guidelines
