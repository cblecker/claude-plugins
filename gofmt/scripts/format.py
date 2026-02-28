#!/usr/bin/env python3
"""Post-tool-use hook that formats Go files with goimports or gofmt."""

import json
import os
import subprocess
import sys


def main():
    try:
        hook_data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_input = hook_data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")

    if not file_path or not file_path.endswith(".go"):
        sys.exit(0)

    if not os.path.isfile(file_path):
        sys.exit(0)

    # Try goimports first, fall back to gofmt
    result = subprocess.run(
        ["go", "run", "golang.org/x/tools/cmd/goimports@latest", "-w", file_path],
        capture_output=True,
    )
    if result.returncode == 0:
        sys.exit(0)

    result = subprocess.run(
        ["gofmt", "-w", file_path],
        capture_output=True,
    )
    if result.returncode == 0:
        sys.exit(0)

    sys.exit(1)


if __name__ == "__main__":
    main()
