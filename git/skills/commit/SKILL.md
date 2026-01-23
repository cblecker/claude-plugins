---
name: git:commit
description: This skill should be used when the user asks to "commit changes", "make a commit", "commit files", "create a commit", "git commit", or mentions committing code. Enhances commits with mainline protection, conventional commits detection, and pre-commit verification.
version: 0.1.0
---

# Git Commit Creation

Enhance commit creation with mainline branch protection, commit style detection, and pre-commit verification steps.

## When to Use This Skill

Use this skill when creating git commits. It provides:
- Protection against committing directly to mainline branches
- Conventional commits format detection and guidance
- Pre-commit verification from CLAUDE.md
- Staged vs unstaged file awareness
- Commit message quality

## Core Workflow

Follow these steps when the user requests creating a commit:

### 1. Pre-Flight Checks

**Check current branch:**

```bash
current_branch=$(git rev-parse --abbrev-ref HEAD)
mainline=$(detect_mainline_branch)  # From reference/mainline-detection.md

if [ "$current_branch" = "$mainline" ]; then
  # User is on mainline - need to create feature branch first
fi
```

**If on mainline branch:**
1. Warn user: "You're on the `{mainline}` branch. Creating a feature branch first is recommended."
2. Invoke `/git:branch` skill using the Skill tool
3. After branch created, continue with commit process

See `reference/mainline-detection.md` for mainline detection logic.

**Verify there are changes to commit:**

```bash
# Check for staged changes
if git diff --cached --quiet; then
  # No staged changes - check for unstaged
  if git diff --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    # No changes at all
    echo "No changes to commit"
    exit 0
  fi
fi
```

### 2. Gather Context

**Detect conventional commits:**

Check if repository uses conventional commits:
1. Look for config files: `commitlint.config.js`, `.commitlintrc*`
2. Analyze commit history (last 10 commits)
3. Check CLAUDE.md

See `reference/conventional-commits.md` for detection logic and commit types.

**Check git status:**

```bash
# See all changes (staged and unstaged)
git status

# Get diff of staged changes
git diff --cached

# Get diff of unstaged changes
git diff
```

**Review recent commits for style:**

```bash
# Last 5-10 commits to understand message format
git log -10 --pretty=format:"%h %s"
```

**Check CLAUDE.md for pre-commit steps:**

Read project CLAUDE.md and look for sections like:
```markdown
## Git Workflow
- Before committing, run: `npm test` and `npm run lint`
```

### 3. Run Pre-Commit Verification

If CLAUDE.md specifies pre-commit steps:

1. Execute each command specified
2. Verify all pass successfully
3. If any fail, report to user and ask how to proceed
4. Do NOT commit if verification fails without user approval

**Example:**
```bash
# CLAUDE.md says: "Before committing, run: npm test"
npm test

if [ $? -ne 0 ]; then
  # Tests failed - ask user before proceeding
fi
```

### 4. Stage Files

**Determine what to stage:**

Prefer staging specific files by name rather than using `git add -A` or `git add .`:
- Safer (avoids accidentally staging sensitive files)
- More intentional
- Clearer what's being committed

**Check for sensitive files:**

Warn before staging:
- `.env`, `.env.*` files
- Files with `credentials`, `secrets`, `password` in name
- `id_rsa`, `.pem`, `.key` files
- `config.local.*` files

**Stage selected files:**

```bash
git add file1.js file2.js file3.js
```

### 5. Craft Commit Message

**If conventional commits detected:**

Follow format: `<type>(<scope>): <description>`

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Formatting (no logic change)
- `refactor` - Code restructuring
- `perf` - Performance improvement
- `test` - Adding tests
- `chore` - Maintenance

**Example:**
```
feat(auth): add OAuth2 login support

Implements OAuth2 authentication with Google and GitHub providers.
Includes token refresh and session management.

Closes #123
```

**If conventional commits NOT detected:**

Use clear, descriptive messages:
- Start with imperative verb (Add, Fix, Update, Remove)
- Be specific about what changed
- Explain why if not obvious

**Example:**
```
Add user authentication with OAuth2

Allows users to log in with Google or GitHub accounts.
```

**Message guidelines:**
- Subject line: Max 50 characters, imperative mood, no period
- Body: Wrap at 72 characters, explain what and why
- Footer: Reference issues, breaking changes

See `reference/conventional-commits.md` for detailed guidance.

### 6. Create Commit

**Hand off to Claude's built-in commit workflow:**

At this point, let Claude's default commit capabilities handle:
- Finalizing message
- Creating the commit
- Co-authored-by attribution

**Format for passing to git:**

Use HEREDOC for proper formatting:

```bash
git commit -m "$(cat <<'EOF'
feat(auth): add OAuth2 login

Implements OAuth2 authentication flow.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
EOF
)"
```

### 7. Verify Success

After commit:

```bash
# Verify commit was created
git log -1 --oneline

# Show current status
git status
```

Report success to user with commit hash and message.

## CLAUDE.md Configuration

Respect CLAUDE.md settings:

**Conventional commits:**
```markdown
## Git Workflow
- This repo uses conventional commits
```

**Pre-commit checks:**
```markdown
## Git Workflow
- Before committing, run: `npm test` and `npm run lint`
```

**Commit message format:**
```markdown
## Git Workflow
- Commit messages: Include issue number in footer
```

**Priority:** CLAUDE.md > Auto-detection > Defaults

## Examples

### Example 1: Commit on Main Branch (Redirects to Branch Creation)

**User request:** "Commit the authentication changes"

**Steps:**
1. Check current branch: `main` (is mainline)
2. Warn: "You're on `main`. Creating feature branch first."
3. Invoke `/git:branch` skill → Creates `feat/authentication`
4. Continue with commit process on new branch
5. Detect conventional commits: Yes
6. Stage files: `git add src/auth.js src/auth.test.js`
7. Craft message: `feat(auth): add user authentication`
8. Create commit and verify

### Example 2: Bug Fix with Pre-Commit Checks

**User request:** "Commit the login fix"

**Steps:**
1. Check branch: `fix/login-bug` (not mainline) ✓
2. Check CLAUDE.md: Says "run: npm test before committing"
3. Run verification: `npm test` → Pass ✓
4. Detect conventional commits: Yes
5. Review changes: `git diff --cached` shows login.js modified
6. Stage: `git add src/login.js`
7. Craft message: `fix(auth): resolve token expiry issue`
8. Create commit and verify

### Example 3: Simple Commit without Conventional Commits

**User request:** "Commit my changes"

**Steps:**
1. Check branch: `update-readme` (not mainline) ✓
2. No pre-commit checks in CLAUDE.md
3. Detect conventional commits: No
4. Review: README.md modified
5. Stage: `git add README.md`
6. Craft message: `Update installation instructions`
7. Create commit and verify

## Error Handling

**No changes to commit:**
```bash
if git diff --cached --quiet; then
  echo "No staged changes. Stage files first with 'git add'."
fi
```

**Pre-commit checks fail:**
```
Tests failed. Options:
1. Fix the failing tests
2. Skip tests (not recommended)
3. Commit anyway (with --no-verify, ask user first)
```

**Sensitive files detected:**
```
WARNING: About to stage .env file which may contain secrets.
Are you sure you want to commit this?
```

**Not in a git repository:**
```
ERROR: Not in a git repository. Initialize with 'git init' first.
```

## Integration with Other Skills

**This skill invokes:**
- **`/git:branch`** - When user tries to commit on mainline

**This skill is invoked by:**
- **`/git:pr`** - When creating PR with uncommitted changes

## Git Safety

Follow safety rules from `reference/git-safety.md`:
- Never commit directly to mainline (redirect to branch creation)
- Check for sensitive files before staging
- Run pre-commit verification if specified
- Use specific file names rather than `git add -A`

## Quick Reference

**Pre-flight checklist:**
1. ✓ Check if on mainline (if yes, create branch first)
2. ✓ Verify changes exist to commit
3. ✓ Run CLAUDE.md pre-commit checks
4. ✓ Check for sensitive files

**Commit message format:**
- With CC: `type(scope): description`
- Without CC: `Imperative description`
- Max 50 chars subject, 72 chars body

**Staging:**
- Prefer specific files: `git add file1 file2`
- Avoid: `git add -A` or `git add .`
- Check for: `.env`, credentials, keys

## Reference Files

For detailed information:
- **`reference/conventional-commits.md`** - Commit format and types
- **`reference/mainline-detection.md`** - Mainline branch identification
- **`reference/git-safety.md`** - Safety guidelines
