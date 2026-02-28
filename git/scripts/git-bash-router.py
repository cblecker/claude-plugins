#!/usr/bin/env python3
# Git command router - Python implementation for portability

import json
import os
import re
import subprocess
import sys


def main():
    # Get mainline branch (cached or detected)
    mainline = os.environ.get("CLAUDE_MAINLINE_BRANCH", "")
    if not mainline:
        plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", "")
        detect_script = os.path.join(plugin_root, "scripts", "detect-mainline.sh")
        result = subprocess.run(
            ["bash", detect_script],
            capture_output=True, text=True, timeout=5
        )
        mainline = result.stdout.strip()

    data = json.load(sys.stdin)
    cmd = data["tool_input"]["command"]

    # Helper: match command at start or after && / ; (with optional override prefix)
    def cmd_match(pattern):
        return bool(re.search(
            r"(^|&&|;)\s*(GIT_WORKFLOWS_OVERRIDE=1\s+)?" + pattern, cmd
        ))

    # Helper: check for force flags
    has_force = bool(re.search(r"\s--force|\s-[a-zA-Z]*f", cmd))

    # Helper: check for dry-run flags
    has_dry_run = bool(re.search(r"\s--dry-run|\s-[a-zA-Z]*n", cmd))

    # Helper: check if pushing to mainline
    def pushing_mainline():
        return (
            bool(re.search(r"\s" + re.escape(mainline) + r"(\s|$)", cmd))
            or bool(re.search(r":" + re.escape(mainline) + r"(\s|$)", cmd))
        )

    # Check for override prefix anywhere in command
    has_override = "GIT_WORKFLOWS_OVERRIDE=1" in cmd

    # Safety checks (always enforced, even with override)
    if cmd_match(r"git push"):
        if has_force and pushing_mainline():
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "Force pushing to mainline is never allowed.",
                }
            }
        elif has_force:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "ask",
                    "permissionDecisionReason": "Force pushing requires explicit user permission.",
                }
            }
        else:
            return None

    elif cmd_match(r"git reset"):
        if "--hard" in cmd:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "additionalContext": "CAUTION: git reset --hard will discard uncommitted changes. Consider backing up first.",
                }
            }
        else:
            return None

    elif cmd_match(r"git clean"):
        if has_force and not has_dry_run:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "additionalContext": "CAUTION: git clean -f permanently deletes untracked files. Use git clean -n first to preview.",
                }
            }
        else:
            return None

    elif cmd_match(r"git rebase"):
        if re.search(r"\s" + re.escape(mainline) + r"(\s|$)", cmd):
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "additionalContext": "WARNING: Rebasing onto mainline. Ensure this is intentional.",
                }
            }
        else:
            return None

    # Skill enforcement (only when override is not present)
    elif not has_override and cmd_match(r"git commit"):
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "Use the git:commit skill instead (invoked via Skill tool). If the skill cannot handle your specific case, prefix the command with GIT_WORKFLOWS_OVERRIDE=1 to bypass this check.",
            }
        }

    elif not has_override and cmd_match(
        r"(?:git checkout -b|git checkout --branch|git switch -c|git switch --create)"
    ):
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "Use the git:branch skill instead (invoked via Skill tool). If the skill cannot handle your specific case, prefix the command with GIT_WORKFLOWS_OVERRIDE=1 to bypass this check.",
            }
        }

    elif not has_override and cmd_match(r"gh pr create"):
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "Use the git:pr skill instead (invoked via Skill tool). If the skill cannot handle your specific case, prefix the command with GIT_WORKFLOWS_OVERRIDE=1 to bypass this check.",
            }
        }

    else:
        return None


if __name__ == "__main__":
    try:
        result = main()
        if result is None:
            print("null")
        else:
            print(json.dumps(result))
    except Exception:
        print("null")
