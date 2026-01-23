# Git Plugin

Enhanced git workflows with smart defaults, safety guardrails, and automatic convention detection.

## Overview

The git plugin enhances Claude Code's built-in git capabilities with:

- **Smart branch creation** - Auto-detects conventional commit style and suggests appropriate prefixes
- **Mainline protection** - Prevents accidental commits directly to main/master branches
- **Fork workflow support** - Auto-detects fork setup and guides PR creation to upstream
- **Conventional commits** - Detects and helps maintain conventional commit style
- **Safety reminders** - Warns before dangerous operations like force push to mainline

## Features

### Skills

- **`/git:branch`** - Create branches with smart naming and base branch awareness
- **`/git:commit`** - Create commits with mainline protection and style detection
- **`/git:pr`** - Create pull requests with fork detection and template discovery

### Hooks

- **PreToolUse hooks** - Provide contextual reminders before git/gh operations
  - Bash git commands: Checks for mainline, conventional commits, safety rules
  - GitHub MCP tools: Verifies fork setup, finds PR templates

## Usage

### Creating a Branch

Ask Claude to create a branch and the plugin will:
1. Detect if conventional commits are used → suggest `feat/`, `fix/`, etc. prefixes
2. Identify mainline branch to use as base
3. Guide you through branch creation with proper naming

### Making a Commit

Ask Claude to commit changes and the plugin will:
1. Check if you're on mainline → guide you to create a branch first
2. Detect commit message style (conventional commits)
3. Run any pre-commit checks specified in CLAUDE.md
4. Help craft an appropriate commit message

### Creating a Pull Request

Ask Claude to create a PR and the plugin will:
1. Check for uncommitted changes → guide you to commit first
2. Detect fork setup (origin vs upstream)
3. Find PR templates in the repository
4. Guide PR creation with proper base branch

## Configuration

The plugin auto-detects repository conventions but respects overrides in your project's `CLAUDE.md`:

```markdown
## Git Workflow
- This repo uses conventional commits
- Branch naming: type/description (e.g., feat/add-login)
- Before committing, run: `npm test` and `npm run lint`
- This is a fork; push to origin, PRs target upstream
```

**Priority**: CLAUDE.md hints > auto-detection > defaults

## How It Works

The plugin uses:
- **Reference files** - Shared detection utilities for mainline, forks, conventional commits, and safety
- **Skill composition** - Skills can invoke each other (`/git:pr` → `/git:commit` → `/git:branch`)
- **PreToolUse hooks** - Non-blocking reminders before git operations

## Safety

All hooks are **non-blocking** - they provide warnings and guidance but never prevent operations. You maintain full control over your git workflow.

## Testing

To test the plugin locally:

```bash
# From the marketplace directory
claude --plugin-dir /path/to/claude-plugins
```

### Test Cases

1. **Branch creation**: Ask "Create a branch for adding authentication"
   - Should detect conventional commits if configured
   - Suggests appropriate branch name with prefix

2. **Commit on mainline**: Ask "Commit my changes" while on main/master
   - Should detect mainline branch
   - Suggests creating feature branch first

3. **Pull request**: Ask "Create a pull request"
   - Detects fork setup (if applicable)
   - Finds PR templates
   - Guides PR creation

4. **Safety hooks**: Try "git push --force origin main"
   - Should warn about dangerous operation
   - Suggests safer alternatives

## License

MIT
