#!/usr/bin/env python3
"""Post-tool-use hook that formats Go files with goimports or gofmt."""

import json
import os
import shutil
import subprocess
import sys

TIMEOUT_SECONDS = 8


def run_formatter(cmd):
    """Run a formatter command, returning True on success."""
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=TIMEOUT_SECONDS)
        return result.returncode == 0
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return False


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

    # Try local goimports binary first
    if shutil.which("goimports") and run_formatter(["goimports", "-w", file_path]):
        sys.exit(0)

    # Fall back to go run goimports
    if shutil.which("go") and run_formatter(
        ["go", "run", "golang.org/x/tools/cmd/goimports@latest", "-w", file_path]
    ):
        sys.exit(0)

    # Fall back to gofmt
    if run_formatter(["gofmt", "-w", file_path]):
        sys.exit(0)

    sys.exit(1)


if __name__ == "__main__":
    main()
