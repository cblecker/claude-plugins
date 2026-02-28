# Gofmt Plugin

Auto-format Go files with goimports or gofmt after Write/Edit operations.

## Overview

This plugin automatically formats Go source files whenever Claude Code writes
or edits them, ensuring consistent formatting without manual intervention.

## How It Works

A PostToolUse hook triggers on `Write` and `Edit` tool calls. When the target
file has a `.go` extension, the hook runs a formatter using this priority:

1. **Local `goimports`** — if installed on `$PATH`, used directly
2. **`go run goimports`** — downloads and runs `goimports` via `go run`
3. **`gofmt`** — built-in Go formatter as a final fallback

Each step is attempted only if the previous one is unavailable or fails.

## Configuration

No configuration required. The plugin activates automatically for any `.go`
file modified through Claude Code.

## License

MIT
