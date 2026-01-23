# Fork Detection

Detect if the repository is a fork with both origin and upstream remotes.

## Detection Strategy

Check for presence of both `origin` and `upstream` remotes:

```bash
# Check if both remotes exist
has_origin=$(git remote | grep -c "^origin$" || true)
has_upstream=$(git remote | grep -c "^upstream$" || true)

if [ "$has_origin" -eq 1 ] && [ "$has_upstream" -eq 1 ]; then
  echo "fork"
else
  echo "direct"
fi
```

## Fork Workflow Implications

### Direct Repository (No Fork)

```
origin: user/repo (your repository)
```

**Workflow:**
- Push to origin
- PRs target origin
- Single remote

### Fork Setup

```
origin: user/fork (your fork)
upstream: org/repo (original repository)
```

**Workflow:**
- Push to origin (your fork)
- PRs target upstream (original repo)
- Keep fork synced with upstream

## Extract Remote Information

```bash
# Get origin owner/repo
origin_url=$(git remote get-url origin)
origin_repo=$(echo "$origin_url" | sed -E 's|.*[:/]([^/]+/[^/]+)(\.git)?$|\1|' | sed 's/\.git$//')

# Get upstream owner/repo (if exists)
if git remote | grep -q "^upstream$"; then
  upstream_url=$(git remote get-url upstream)
  upstream_repo=$(echo "$upstream_url" | sed -E 's|.*[:/]([^/]+/[^/]+)(\.git)?$|\1|' | sed 's/\.git$//')
fi
```

**Parse result:**
- `origin_repo` = "user/fork"
- `upstream_repo` = "org/repo"

## Push Target Determination

```bash
if [ "$is_fork" = "true" ]; then
  push_remote="origin"  # Push to your fork
  pr_base_remote="upstream"  # PR targets upstream
else
  push_remote="origin"  # Push to main repo
  pr_base_remote="origin"  # PR targets same repo
fi
```

## CLAUDE.md Override

Allow users to override auto-detection:

```markdown
## Git Workflow
- This is a fork; push to origin, PRs target upstream
```

Or:

```markdown
## Git Workflow
- Not a fork; push to origin, PRs target origin
```

**Priority**: CLAUDE.md > Auto-detection

## Common Patterns

### Personal Fork of OSS Project

```
origin: yourname/kubernetes (fork)
upstream: kubernetes/kubernetes (original)
```

**Actions:**
- Branch from upstream/main
- Push to origin
- PR to upstream

### Organization Repository

```
origin: company/product (direct)
```

**Actions:**
- Branch from origin/main
- Push to origin
- PR to origin

### Multiple Forks

Some workflows use additional remotes:
```
origin: yourname/fork
upstream: org/repo
colleague: colleague/fork
```

**Recommendation**: Only detect origin/upstream pattern, treat others as advanced usage.

## Validation

```bash
# Verify remotes point to different repositories
origin_host=$(git remote get-url origin | sed -E 's|^.*://([^/]+)/.*$|\1|')
upstream_host=$(git remote get-url upstream | sed -E 's|^.*://([^/]+)/.*$|\1|')

origin_path=$(git remote get-url origin | sed -E 's|.*[:/]([^/]+/[^/]+)(\.git)?$|\1|')
upstream_path=$(git remote get-url upstream | sed -E 's|.*[:/]([^/]+/[^/]+)(\.git)?$|\1|')

# True fork if paths differ
if [ "$origin_path" != "$upstream_path" ]; then
  echo "Valid fork setup"
fi
```

## Error Handling

If remote detection fails:
- Ask user about fork setup
- Suggest configuring upstream if it's a fork
- Document in CLAUDE.md
