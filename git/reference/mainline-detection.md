# Mainline Branch Detection

Detect the primary development branch (main/master) for a git repository.

## Detection Strategy

Use this priority order:

### 1. Primary: Remote HEAD Symref

```bash
git ls-remote --symref origin HEAD | grep "^ref:" | awk '{print $2}' | sed 's|refs/heads/||'
```

**Advantages:**
- Most reliable (uses remote's default branch setting)
- Works even if local branch doesn't exist
- Reflects repository configuration

**Disadvantages:**
- Requires network access
- Fails if no remote configured

### 2. Fallback: Local Branch Check

```bash
if git rev-parse --verify main >/dev/null 2>&1; then
  echo "main"
elif git rev-parse --verify master >/dev/null 2>&1; then
  echo "master"
fi
```

**Advantages:**
- Works offline
- Fast, no network calls

**Disadvantages:**
- May not match remote default
- Fails if neither main nor master exists

### 3. CLAUDE.md Override

Check project CLAUDE.md for explicit mainline configuration:

```markdown
## Git Workflow
- Mainline branch: develop
```

**Priority**: CLAUDE.md > Remote detection > Local fallback

## Usage Pattern

```bash
# Try remote first
mainline=$(git ls-remote --symref origin HEAD 2>/dev/null | grep "^ref:" | awk '{print $2}' | sed 's|refs/heads/||')

# Fallback to local detection
if [ -z "$mainline" ]; then
  if git rev-parse --verify main >/dev/null 2>&1; then
    mainline="main"
  elif git rev-parse --verify master >/dev/null 2>&1; then
    mainline="master"
  fi
fi

echo "$mainline"
```

## Caching

For performance, cache the result for the session:

```bash
# Check if cached
if [ -n "$CLAUDE_MAINLINE_BRANCH" ]; then
  echo "$CLAUDE_MAINLINE_BRANCH"
  exit 0
fi

# Detect and cache
mainline=$(detect_mainline)
echo "export CLAUDE_MAINLINE_BRANCH='$mainline'" >> "$CLAUDE_ENV_FILE"
echo "$mainline"
```

## Common Branch Names

- `main` - GitHub default since 2020
- `master` - Traditional default
- `develop` - GitFlow development branch
- `trunk` - Monorepo common name

## Error Handling

If detection fails:
- Ask user which branch is mainline
- Default to "main" if no answer
- Document in CLAUDE.md for future sessions
