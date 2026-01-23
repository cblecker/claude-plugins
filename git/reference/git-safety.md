# Git Safety Rules

Guidelines for preventing destructive git operations and maintaining repository integrity.

## Dangerous Operations

### Force Push to Mainline

**Never force push to main/master branches:**

```bash
# DANGEROUS - Don't do this
git push --force origin main
git push -f origin master
```

**Why it's dangerous:**
- Rewrites shared history
- Breaks other contributors' branches
- Can lose commits permanently
- Disrupts CI/CD pipelines

**Check before force push:**

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
mainline=$(detect_mainline_branch)  # main or master

if [ "$branch" = "$mainline" ]; then
  echo "ERROR: Never force push to $mainline"
  exit 1
fi
```

### Use --force-with-lease Instead

**Safer alternative to --force:**

```bash
# Better - Checks remote state first
git push --force-with-lease origin feature-branch
```

**Why it's safer:**
- Verifies remote hasn't changed since last fetch
- Prevents overwriting others' work
- Still allows intentional history rewrites on feature branches

**When to use:**
- Rebasing feature branches
- Amending pushed commits on your branch
- Cleaning up WIP commits before PR

### Hard Reset

**Destructive - loses uncommitted changes:**

```bash
# DANGEROUS - Loses all uncommitted work
git reset --hard HEAD
git reset --hard origin/main
```

**Safer alternatives:**

```bash
# Stash changes instead
git stash save "WIP: describe work"

# Or commit to temporary branch
git checkout -b backup-$(date +%Y%m%d)
git commit -am "Backup before reset"
```

**When hard reset is appropriate:**
- You're certain you want to discard changes
- You've backed up important work
- You're recovering from a botched merge

### Git Clean

**Removes untracked files permanently:**

```bash
# DANGEROUS - Deletes untracked files
git clean -f
git clean -fd  # Including directories
git clean -fdx # Including ignored files
```

**Safer approach:**

```bash
# Preview what would be deleted
git clean -n
git clean -nd

# Then clean if certain
git clean -f
```

**Risk areas:**
- Build artifacts you need
- Local configuration files
- Generated documentation
- Untracked IDE files

## Mainline Protection

### Direct Commits to Mainline

**Avoid committing directly to main/master:**

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
mainline=$(detect_mainline_branch)

if [ "$branch" = "$mainline" ]; then
  echo "WARNING: You're on $mainline branch"
  echo "Create a feature branch instead: git checkout -b feature-name"
fi
```

**Why:**
- Bypasses code review
- No PR discussion
- Harder to revert
- Breaks team workflow

**Exceptions:**
- Hotfixes (with team approval)
- README updates (minor)
- Version bumps
- Emergency fixes

### Branch Protection

Enable on GitHub/GitLab:
- Require pull requests
- Require reviews
- Require status checks
- Prevent force push
- Prevent deletion

## Rewriting History

### Safe to Rewrite

**Your feature branches before pushing:**

```bash
# Safe - haven't pushed yet
git commit --amend
git rebase -i HEAD~3
git reset HEAD~1
```

**Your feature branches after pushing (with care):**

```bash
# Safe if you're the only one on this branch
git rebase main
git push --force-with-lease
```

### Never Rewrite

**Shared branches (main, develop, release branches):**

```bash
# NEVER do this on shared branches
git rebase
git commit --amend
git reset HEAD~1
git filter-branch
```

**After others have pulled your branch:**

Coordinate with team before rewriting history.

## Merge Conflicts

### Safe Resolution

```bash
# Check conflict markers resolved
if git diff --check; then
  echo "No conflict markers found"
else
  echo "ERROR: Unresolved conflict markers"
  exit 1
fi

# Test before committing merge
npm test  # or your test command
```

### Abort if Uncertain

```bash
# Abort merge
git merge --abort

# Abort rebase
git rebase --abort

# Abort cherry-pick
git cherry-pick --abort
```

## Pre-Operation Checks

### Before Force Push

```bash
# 1. Verify branch
branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  echo "ERROR: Cannot force push to $branch"
  exit 1
fi

# 2. Check if others are using this branch
# (requires communication with team)

# 3. Use --force-with-lease
git push --force-with-lease origin "$branch"
```

### Before Hard Reset

```bash
# 1. Check what will be lost
git status
git diff HEAD

# 2. Create backup
git stash save "Backup before reset $(date)"
# or
git branch backup-$(date +%Y%m%d-%H%M%S)

# 3. Then reset
git reset --hard HEAD
```

### Before Rebasing

```bash
# 1. Fetch latest
git fetch origin

# 2. Create backup branch
git branch backup-before-rebase

# 3. Rebase
git rebase origin/main

# 4. If issues, abort
git rebase --abort
# Restore from backup
git reset --hard backup-before-rebase
```

## Recovery Procedures

### Recover Lost Commits

```bash
# Find lost commits
git reflog

# Recover specific commit
git cherry-pick <commit-hash>

# Or reset to it
git reset --hard <commit-hash>
```

### Undo Force Push (if still in reflog)

```bash
# Find pre-push state
git reflog

# Reset local branch
git reset --hard <commit-hash>

# Force push again (if you control the branch)
git push --force-with-lease
```

### Restore Deleted Branch

```bash
# Find branch in reflog
git reflog | grep <branch-name>

# Recreate branch
git branch <branch-name> <commit-hash>
```

## Commit Signing

### Verify Commits are Signed

```bash
# Check if commits are signed
git log --show-signature -1

# Configure commit signing
git config --global commit.gpgsign true
git config --global user.signingkey <key-id>
```

**Benefits:**
- Verifies commit authorship
- Required by some organizations
- Prevents impersonation

## Hook Integration

When implementing as PreToolUse hooks:

### Bash Command Patterns

```regex
# Force push patterns
git push.*--force(?!-with-lease)
git push.*-f\s

# Hard reset patterns
git reset.*--hard

# Clean patterns
git clean.*-f

# Rebase on mainline
git rebase.*(main|master)
```

### Warning Messages

Keep warnings concise (1-2 sentences):

```
WARNING: Force push detected. Use --force-with-lease instead to prevent overwriting others' work.
```

```
WARNING: Hard reset will lose uncommitted changes. Consider git stash or create backup branch first.
```

```
WARNING: You're on main branch. Create feature branch: git checkout -b feat/your-feature
```

## CLAUDE.md Configuration

Allow users to configure safety rules:

```markdown
## Git Workflow
- Allow force push to: feature-*, fix-*
- Protected branches: main, master, develop, release-*
- Require commit signing: true
- Pre-commit checks: npm test && npm run lint
```

## Best Practices Summary

**DO:**
- ✅ Create feature branches
- ✅ Use --force-with-lease instead of --force
- ✅ Backup before destructive operations
- ✅ Preview with -n flag (git clean -n)
- ✅ Use git reflog for recovery
- ✅ Test before pushing

**DON'T:**
- ❌ Force push to main/master
- ❌ Rewrite shared history
- ❌ Hard reset without backup
- ❌ Clean without previewing
- ❌ Commit directly to mainline
- ❌ Ignore warnings

## Resources

- **Git Reflog**: https://git-scm.com/docs/git-reflog
- **Force with Lease**: https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegt
- **Branch Protection**: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches
