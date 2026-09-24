# golang

Go development tools for Claude Code.

## Features

### gopls MCP server

Runs `gopls mcp` as an MCP server, providing Go-aware code intelligence such as
go-to-definition, find references, hover documentation, and workspace symbols.

### gopls LSP server

Registers `gopls` as the language server for `.go` files, enabling LSP-based
diagnostics and code navigation.

### Automatic gofmt formatting

A PostToolUse hook runs `gofmt -w -s` on any `.go` file after it is written or
edited, keeping code consistently formatted.

## Prerequisites

- Go toolchain with `gofmt` in `PATH`
- `gopls` in `PATH`
- `jq` in `PATH` (used by the gofmt hook)

Install `gopls` if not already present:

```bash
go install golang.org/x/tools/gopls@latest
```

## License

Apache License 2.0. See [LICENSE](../LICENSE) for details.
