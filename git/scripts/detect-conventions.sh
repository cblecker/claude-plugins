#!/usr/bin/env bash
# Detect if repository uses conventional commits
# Output format: CONVENTIONAL_COMMITS=yes/no (reason)

set -euo pipefail

# Check cache first
if [ -n "${CLAUDE_CONVENTIONAL_COMMITS:-}" ]; then
  echo "$CLAUDE_CONVENTIONAL_COMMITS"
  exit 0
fi

# Cache result to CLAUDE_ENV_FILE if available
cache_result() {
  local result="$1"
  if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -f "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export CLAUDE_CONVENTIONAL_COMMITS='$result'" >> "$CLAUDE_ENV_FILE"
  fi
  echo "$result"
}

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
    cache_result "CONVENTIONAL_COMMITS=yes (config file: $config_file)"
    exit 0
  fi
done

# Check package.json for commitlint
if [[ -f package.json ]] && grep -q '"commitlint"' package.json 2>/dev/null; then
  cache_result "CONVENTIONAL_COMMITS=yes (package.json)"
  exit 0
fi

# Count conventional commit patterns in last 10 commits
# Pattern: type(scope): description or type: description
conventional_count=$(git log -10 --oneline --no-merges 2>/dev/null | \
  grep -cE '^[a-f0-9]+ (build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\(.+\))?!?: ' || true)

if (( conventional_count >= 7 )); then
  cache_result "CONVENTIONAL_COMMITS=yes ($conventional_count/10 commits match conventional format)"
elif (( conventional_count >= 3 )); then
  cache_result "CONVENTIONAL_COMMITS=maybe ($conventional_count/10 commits match conventional format)"
else
  cache_result "CONVENTIONAL_COMMITS=no ($conventional_count/10 commits match conventional format)"
fi
