#!/usr/bin/env bash
# Post-tool-use hook that formats Go files with goimports or gofmt.
set -euo pipefail

TIMEOUT_SECONDS=8

input=$(cat)

file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

# Fast path: skip non-Go files
[[ "$file_path" == *.go ]] || exit 0

# Try local goimports binary first
if command -v goimports >/dev/null 2>&1; then
  timeout "$TIMEOUT_SECONDS" goimports -w "$file_path" && exit 0
fi

# Fall back to go run goimports
if command -v go >/dev/null 2>&1; then
  timeout "$TIMEOUT_SECONDS" go run golang.org/x/tools/cmd/goimports@latest -w "$file_path" && exit 0
fi

# Fall back to gofmt
timeout "$TIMEOUT_SECONDS" gofmt -w "$file_path" && exit 0

exit 1
