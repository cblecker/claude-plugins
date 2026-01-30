#!/usr/bin/env bash
# Detect mainline branch
# Priority: Cached > Origin HEAD > Local fallback
# Note: CLAUDE.md workflow overrides (like "allow mainline commits") are
# handled by skills which have LLM context to parse varied formats.

# Check cache first
if [ -n "$CLAUDE_MAINLINE_BRANCH" ]; then
  echo "$CLAUDE_MAINLINE_BRANCH"
  exit 0
fi

mainline=$(git ls-remote --symref origin HEAD 2>/dev/null | grep "^ref:" | awk '{print $2}' | sed 's|refs/heads/||')

# Fallback to local detection
if [ -z "$mainline" ]; then
  if git rev-parse --verify main >/dev/null 2>&1; then
    mainline="main"
  elif git rev-parse --verify master >/dev/null 2>&1; then
    mainline="master"
  else
    mainline="main"  # Default fallback
  fi
fi

# Cache for session if env file available
if [ -n "$CLAUDE_ENV_FILE" ] && [ -f "$CLAUDE_ENV_FILE" ]; then
  echo "export CLAUDE_MAINLINE_BRANCH='$mainline'" >> "$CLAUDE_ENV_FILE"
fi

echo "$mainline"
