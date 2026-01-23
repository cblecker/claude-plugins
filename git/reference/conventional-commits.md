# Conventional Commits Detection

Detect if a repository uses Conventional Commits format and provide appropriate guidance.

## What are Conventional Commits?

A standardized commit message format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Example:**
```
feat(auth): add OAuth2 login support

Implements OAuth2 authentication flow with Google and GitHub providers.
Includes token refresh logic and session management.

Closes #123
```

## Detection Methods

### 1. Configuration Files

Check for conventional commits tooling:

```bash
# commitlint
[ -f "commitlint.config.js" ] || \
[ -f ".commitlintrc" ] || \
[ -f ".commitlintrc.json" ] || \
[ -f ".commitlintrc.yml" ]

# package.json config
[ -f "package.json" ] && grep -q "commitlint" package.json

# .git/hooks/commit-msg
[ -f ".git/hooks/commit-msg" ] && grep -q "commitlint\|conventional" .git/hooks/commit-msg
```

**If any exist**: Repository uses conventional commits

### 2. Commit History Analysis

Analyze last 10 commits:

```bash
# Get commit messages
git log -10 --pretty=format:%s

# Count conventional format matches
conventional_count=$(git log -10 --pretty=format:%s | grep -cE "^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?:" || true)

# If 60%+ match conventional format
threshold=6
if [ "$conventional_count" -ge "$threshold" ]; then
  echo "conventional-commits-detected"
fi
```

**Regex pattern:**
```
^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?:
```

### 3. CLAUDE.md Override

Allow explicit configuration:

```markdown
## Git Workflow
- This repo uses conventional commits
- Branch naming: type/description (e.g., feat/add-login)
```

**Priority**: CLAUDE.md > Config files > History analysis

## Commit Types

### Standard Types

| Type | Description | Example |
|------|-------------|---------|
| `feat` | New feature | `feat(api): add user endpoint` |
| `fix` | Bug fix | `fix(auth): resolve token expiry` |
| `docs` | Documentation | `docs(readme): update install steps` |
| `style` | Code style (no logic change) | `style(format): fix indentation` |
| `refactor` | Code refactoring | `refactor(db): simplify query logic` |
| `perf` | Performance improvement | `perf(cache): add Redis caching` |
| `test` | Add/update tests | `test(api): add endpoint tests` |
| `chore` | Maintenance | `chore(deps): update dependencies` |
| `build` | Build system changes | `build(webpack): update config` |
| `ci` | CI/CD changes | `ci(github): add deployment workflow` |

### Breaking Changes

Indicate with `!` or `BREAKING CHANGE:` footer:

```
feat(api)!: redesign authentication endpoint

BREAKING CHANGE: The /auth endpoint now requires OAuth2.
```

## Branch Naming Convention

When conventional commits detected, suggest matching branch names:

```
feat/description    - New features
fix/description     - Bug fixes
docs/description    - Documentation
refactor/description - Refactoring
test/description    - Test additions
chore/description   - Maintenance
```

**Example:**
- Commit: `feat(auth): add OAuth2`
- Branch: `feat/oauth2-support`

## Commit Message Guidance

### Format Template

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Rules:**
- Subject: Imperative mood, lowercase, no period, max 50 chars
- Body: Explain what and why (not how), wrap at 72 chars
- Footer: Reference issues, breaking changes

### Examples

**Good:**
```
fix(parser): handle null values in JSON input

The parser crashed when encountering null values in nested objects.
Added null checks and default value handling.

Fixes #456
```

**Bad:**
```
Fixed a bug
```

## Scope Guidelines

Scopes organize commits by component:

**Examples:**
- `(auth)` - Authentication module
- `(api)` - API endpoints
- `(ui)` - User interface
- `(db)` - Database layer
- `(docs)` - Documentation

**Optional but recommended** for larger projects.

## Detection Result Format

When returning detection results, provide:

```json
{
  "uses_conventional_commits": true,
  "detection_method": "config_file|history|claude_md",
  "confidence": "high|medium|low",
  "suggested_types": ["feat", "fix", "docs", "refactor", "test", "chore"],
  "branch_prefix_recommendation": true
}
```

## Validation

If user provides commit message, validate format:

```bash
message="feat(auth): add login"

# Check format
if echo "$message" | grep -qE "^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(.+\))?:.+"; then
  echo "Valid conventional commit"
else
  echo "Does not match conventional commits format"
fi
```

## Resources

- **Specification**: https://www.conventionalcommits.org/
- **commitlint**: https://commitlint.js.org/
- **Standard Version**: https://github.com/conventional-changelog/standard-version
