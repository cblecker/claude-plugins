#!/usr/bin/env bash
# Git command router - pure jq implementation for portability

# Get mainline branch (cached or detected)
mainline="${CLAUDE_MAINLINE_BRANCH:-}"
if [[ -z "$mainline" ]]; then
  mainline=$("${CLAUDE_PLUGIN_ROOT}/scripts/detect-mainline.sh")
fi

# All routing and logic in jq
jq -r --arg mainline "$mainline" '
  .tool_input.command as $cmd |

  # Helper: check for force flags
  def has_force: test("\\s--force|\\s-[a-zA-Z]*f");

  # Helper: check for dry-run flags
  def has_dry_run: test("\\s--dry-run|\\s-[a-zA-Z]*n");

  # Helper: check if pushing to mainline
  def pushing_mainline:
    test("\\s" + $mainline + "(\\s|$)") or test(":" + $mainline + "(\\s|$)");

  # Route based on command prefix
  if ($cmd | startswith("git push")) then
    if ($cmd | has_force) and ($cmd | pushing_mainline) then
      {hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Force pushing to mainline is never allowed."
      }}
    elif ($cmd | has_force) then
      {hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Force pushing requires explicit user permission."
      }}
    else null end

  elif ($cmd | startswith("git commit")) then
    {hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: "Consider using /git:commit skill instead. It provides mainline protection, conventional commits detection, and respects CLAUDE.md workflow configuration."
    }}

  elif ($cmd | startswith("git checkout -b")) or ($cmd | startswith("git switch -c")) then
    {hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: "Consider using /git:branch skill instead. It provides smart branch naming based on conventional commits detection."
    }}

  elif ($cmd | startswith("git reset")) then
    if ($cmd | test("--hard")) then
      {hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: "CAUTION: git reset --hard will discard uncommitted changes. Consider backing up first."
      }}
    else null end

  elif ($cmd | startswith("git clean")) then
    if ($cmd | has_force) and (($cmd | has_dry_run) | not) then
      {hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: "CAUTION: git clean -f permanently deletes untracked files. Use git clean -n first to preview."
      }}
    else null end

  elif ($cmd | startswith("git rebase")) then
    if ($cmd | test("\\s" + $mainline + "(\\s|$)")) then
      {hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: "WARNING: Rebasing onto mainline. Ensure this is intentional."
      }}
    else null end

  elif ($cmd | startswith("gh ")) then
    {hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: "Consider using GitHub MCP tools (mcp__plugin_github_github__*) for better integration."
    }}

  else null end
'
