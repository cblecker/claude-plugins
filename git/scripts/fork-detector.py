#!/usr/bin/env python3
# Fork detection for PR creation - warns when PR owner doesn't match upstream

import json
import re
import subprocess
import sys


def main():
    data = json.load(sys.stdin)

    # Check if upstream remote exists
    result = subprocess.run(
        ["git", "remote", "get-url", "upstream"],
        capture_output=True, text=True
    )
    url = result.stdout.strip()
    if not url:
        return None

    # Extract owner from upstream URL (handles git@ and https:// formats)
    match = re.search(r"[:/](?P<owner>[^/]+)/[^/]+(\.git)?$", url)
    if not match:
        return None

    upstream_owner = match.group("owner")
    pr_owner = data.get("tool_input", {}).get("owner", "")

    if pr_owner != upstream_owner:
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": "WARNING: Fork detected (upstream remote exists). PR owner should be the upstream repository owner, not your fork.",
            }
        }

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
