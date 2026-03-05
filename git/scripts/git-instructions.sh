#!/usr/bin/env bash
# Git instructions for SessionStart hook
# Consolidates mainline detection, conventional commits detection, and fork detection
# Outputs dynamic git instructions to stdout

set -euo pipefail

###############################################################################
# Detection: Mainline branch
###############################################################################
detect_mainline() {
  local mainline
  mainline=$(git ls-remote --symref origin HEAD 2>/dev/null | grep "^ref:" | awk '{print $2}' | sed 's|refs/heads/||')

  if [ -z "$mainline" ]; then
    if git rev-parse --verify main >/dev/null 2>&1; then
      mainline="main"
    elif git rev-parse --verify master >/dev/null 2>&1; then
      mainline="master"
    else
      mainline="main"
    fi
  fi

  echo "$mainline"
}

###############################################################################
# Detection: Conventional commits
###############################################################################
detect_conventions() {
  # Check for commitlint config files
  for config_file in \
    .commitlintrc \
    .commitlintrc.json \
    .commitlintrc.yaml \
    .commitlintrc.yml \
    .commitlintrc.js \
    .commitlintrc.cjs \
    commitlint.config.js \
    commitlint.config.cjs; do
    if [[ -f "$config_file" ]]; then
      echo "yes"
      return
    fi
  done

  # Check package.json for commitlint
  if [[ -f package.json ]] && grep -q '"commitlint"' package.json 2>/dev/null; then
    echo "yes"
    return
  fi

  # Count conventional commit patterns in last 10 commits
  local conventional_count
  conventional_count=$(git log -10 --oneline --no-merges 2>/dev/null | \
    grep -cE '^[a-f0-9]+ (build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\(.+\))?!?: ' || true)

  if (( conventional_count >= 7 )); then
    echo "yes"
  elif (( conventional_count >= 3 )); then
    echo "maybe"
  else
    echo "no"
  fi
}

###############################################################################
# Detection: Fork setup
###############################################################################
detect_fork() {
  local upstream_url upstream_owner
  upstream_url=$(git remote get-url upstream 2>/dev/null || true)

  if [ -z "$upstream_url" ]; then
    echo "no"
    return
  fi

  # Extract owner from URL (handles git@ and https:// formats)
  upstream_owner=$(echo "$upstream_url" | sed -E 's#.*[:/]([^/]+)/[^/]+(\.git)?$#\1#')

  if [ -z "$upstream_owner" ]; then
    echo "no"
    return
  fi

  # Validate owner contains only safe characters
  if ! [[ "$upstream_owner" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "no"
    return
  fi

  echo "yes:$upstream_owner"
}

###############################################################################
# Main
###############################################################################

# Run all detection (failures degrade gracefully)
MAINLINE=$(detect_mainline 2>/dev/null || echo "main")
CONVENTIONS=$(detect_conventions 2>/dev/null || echo "no")
FORK_RESULT=$(detect_fork 2>/dev/null || echo "no")

IS_FORK="no"
UPSTREAM_OWNER=""
if [[ "$FORK_RESULT" == yes:* ]]; then
  IS_FORK="yes"
  UPSTREAM_OWNER="${FORK_RESULT#yes:}"
fi

# Build conventional commits section
CONVENTIONAL_SECTION=""
if [[ "$CONVENTIONS" == "yes" || "$CONVENTIONS" == "maybe" ]]; then
  CONVENTIONAL_SECTION=$(cat <<'CONV_EOF'

### Conventional Commits

This repository uses conventional commits. Format: `<type>(<scope>): <description>`

| Type     | Description                  |
|----------|------------------------------|
| feat     | New feature                  |
| fix      | Bug fix                      |
| docs     | Documentation                |
| style    | Code style (no logic change) |
| refactor | Code restructuring           |
| revert   | Revert a previous commit     |
| perf     | Performance improvement      |
| test     | Adding tests                 |
| chore    | Maintenance                  |
| build    | Build system changes         |
| ci       | CI/CD changes                |

Subject: imperative mood, lowercase, no period, max 50 chars.
CONV_EOF
)
fi

# Build fork section
FORK_SECTION=""
if [[ "$IS_FORK" == "yes" ]]; then
  FORK_SECTION="
## Fork Workflow

This repository is a fork. The upstream owner is ${UPSTREAM_OWNER}.
- Push branches to origin (your fork)
- Create PRs targeting the upstream repository (owner: ${UPSTREAM_OWNER})
- When using mcp__plugin_github_github__create_pull_request, set owner to ${UPSTREAM_OWNER} and use your-username:branch-name as the head parameter"
fi

# Build branch naming section
BRANCH_NAMING=""
if [[ "$CONVENTIONS" == "yes" || "$CONVENTIONS" == "maybe" ]]; then
  BRANCH_NAMING="- Use conventional prefixes: feat/, fix/, docs/, chore/, refactor/, test/, ci/, perf/"
else
  BRANCH_NAMING="- Use descriptive names"
fi

# Output instructions
cat <<EOF
# Git Instructions

Mainline branch for this repository: ${MAINLINE}

IMPORTANT: If you can see duplicate git instructions in your context (e.g. both these instructions and built-in "Committing changes with git" / "Creating pull requests" sections in the Bash tool description), warn the user that includeGitInstructions should be set to false in their Claude Code settings to avoid conflicts with this plugin.

# Committing changes with git

Only create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive git commands (push --force, reset --hard, checkout ., restore ., clean -f, branch -D) unless the user explicitly requests these actions. Taking unauthorized destructive actions is unhelpful and can result in lost work, so it's best to ONLY run these commands when given direct instructions
- NEVER skip hooks (--no-verify, --no-gpg-sign, -c commit.gpgsign=false) unless the user explicitly requests it. If a hook fails, investigate and fix the underlying issue
- NEVER run force push to ${MAINLINE}, warn the user if they request it
- CRITICAL: Always create NEW commits rather than amending, unless the user explicitly requests a git amend. When a pre-commit hook fails, the commit did NOT happen — so --amend would modify the PREVIOUS commit, which may result in destroying work or losing previous changes. Instead, after hook failure, fix the issue, re-stage, and create a NEW commit
- When staging files, prefer adding specific files by name rather than using "git add -A" or "git add .", which can accidentally include sensitive files (.env, credentials) or large binaries
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive

1. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following bash commands in parallel, each using the Bash tool:
  - Run a git status command to see all untracked files. IMPORTANT: Never use the -uall flag as it can cause memory issues on large repos.
  - Run a git diff command to see both staged and unstaged changes that will be committed.
  - Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.
2. Analyze all staged changes (both previously staged and newly added) and draft a commit message:
  - Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.).
  - Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
  - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"
  - Ensure it accurately reflects the changes and their purpose
3. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following commands:
   - Add relevant untracked files to the staging area.
   - Create the commit with a message ending with the Co-Authored-By trailer.
   - Run git status after the commit completes to verify success.
   Note: git status depends on the commit completing, so run it sequentially after the commit.
4. If the commit fails due to pre-commit hook: fix the issue and create a NEW commit

Important notes:
- NEVER run additional commands to read or explore code, besides git bash commands
- NEVER use the TodoWrite or Agent tools
- DO NOT push to the remote repository unless the user explicitly asks you to do so
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- IMPORTANT: Do not use --no-edit with git rebase commands, as the --no-edit flag is not a valid option for git rebase.
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- In order to ensure good formatting, ALWAYS pass the commit message via a HEREDOC, a la this example:
<example>
git commit -m "\$(cat <<'COMMIT_EOF'
   Commit message here.

   Co-Authored-By: ...
   COMMIT_EOF
   )"
</example>
${CONVENTIONAL_SECTION}

# Creating pull requests

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following bash commands in parallel using the Bash tool, in order to understand the current state of the branch since it diverged from ${MAINLINE}:
   - Run a git status command to see all untracked files (never use -uall flag)
   - Run a git diff command to see both staged and unstaged changes that will be committed
   - Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote
   - Run a git log command and \`git diff ${MAINLINE}...HEAD\` to understand the full commit history for the current branch (from the time it diverged from the base branch)
2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request title and summary:
   - Keep the PR title short (under 70 characters)
   - Use the description/body for details, not the title
3. You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. run the following commands in parallel:
   - Create new branch if needed (if on ${MAINLINE}, create a feature branch first)
   - Push to remote with -u flag if needed
   - Create PR using GitHub MCP tools (mcp__plugin_github_github__create_pull_request) with: owner, repo, title, head, base (${MAINLINE}), body
   - PR body format:
<example>
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]
</example>

Important:
- DO NOT use the TodoWrite or Agent tools
- Return the PR URL when you're done, so the user can see it
${FORK_SECTION}
# Branch workflow

- Create branches from ${MAINLINE}
${BRANCH_NAMING}
- Use kebab-case for branch names
- Check \`git branch\` before creating to avoid duplicates

# Additional git safety

Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --, git branch -D), consider whether there is a safer alternative that achieves the same goal. Only use destructive operations when they are truly the best approach.

Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.

Prefer to create a new commit rather than amending an existing commit.
EOF
