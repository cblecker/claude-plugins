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

  # Helper: match command at start or after && / ; (with optional override prefix)
  def cmd_match($p): test("(^|&&|;)\\s*(GIT_WORKFLOWS_OVERRIDE=1\\s+)?" + $p);

  # Helper: check for force flags
  def has_force: test("\\s--force|\\s-[a-zA-Z]*f");

  # Helper: check for dry-run flags
  def has_dry_run: test("\\s--dry-run|\\s-[a-zA-Z]*n");

  # Helper: check if pushing to mainline
  def pushing_mainline:
    test("\\s" + $mainline + "(\\s|$)") or test(":" + $mainline + "(\\s|$)");

  # Check for override prefix anywhere in command
  ($cmd | test("GIT_WORKFLOWS_OVERRIDE=1")) as $has_override |

  # Safety checks (always enforced, even with override)
  if ($cmd | cmd_match("git push")) then
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

  elif ($cmd | cmd_match("git reset")) then
    if ($cmd | test("--hard")) then
      {hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: "CAUTION: git reset --hard will discard uncommitted changes. Consider backing up first."
      }}
    else null end

  elif ($cmd | cmd_match("git clean")) then
    if ($cmd | has_force) and (($cmd | has_dry_run) | not) then
      {hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: "CAUTION: git clean -f permanently deletes untracked files. Use git clean -n first to preview."
      }}
    else null end

  elif ($cmd | cmd_match("git rebase")) then
    if ($cmd | test("\\s" + $mainline + "(\\s|$)")) then
      {hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: "WARNING: Rebasing onto mainline. Ensure this is intentional."
      }}
    else null end

  # Skill enforcement (only when override is not present)
  elif ($has_override | not) and ($cmd | cmd_match("git commit")) then
    {hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Use the git:commit skill instead (invoked via Skill tool). If the skill cannot handle your specific case, prefix the command with GIT_WORKFLOWS_OVERRIDE=1 to bypass this check."
    }}

  elif ($has_override | not) and ($cmd | cmd_match("(?:git checkout -b|git checkout --branch|git switch -c|git switch --create)")) then
    {hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Use the git:branch skill instead (invoked via Skill tool). If the skill cannot handle your specific case, prefix the command with GIT_WORKFLOWS_OVERRIDE=1 to bypass this check."
    }}

  elif ($has_override | not) and ($cmd | cmd_match("gh pr create")) then
    {hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Use the git:pr skill instead (invoked via Skill tool). If the skill cannot handle your specific case, prefix the command with GIT_WORKFLOWS_OVERRIDE=1 to bypass this check."
    }}

  else null end
'
