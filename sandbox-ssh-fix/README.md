# sandbox-ssh-fix

Workaround for broken git-over-SSH in the Claude Code sandbox on macOS.

## Problem

The Claude Code sandbox injects `GIT_SSH_COMMAND` with a `ProxyCommand` using
BSD `nc -X 5` for SOCKS5 proxying. On macOS, `nc` doesn't support SOCKS5
authentication, and the proxy requires auth — breaking all git-over-SSH
operations (`git fetch`, `git push`, `git pull`).

Tracked upstream: <https://github.com/anthropics/claude-code/issues/70684>

## How it works

A SessionStart hook detects the broken pattern and overrides `GIT_SSH_COMMAND`
via `$CLAUDE_ENV_FILE`:

- If `ncat` is available: uses `ncat --proxy-type socks5 --proxy-auth` with
  credentials parsed from `ALL_PROXY`
- If `ncat` is not available: falls back to plain `ssh` (bypasses the proxy,
  relies on the sandbox network allowlist)

The fix only activates when all conditions are met:

1. Running inside the sandbox (`SANDBOX_RUNTIME=1`)
2. `GIT_SSH_COMMAND` contains the broken `nc -X 5` pattern
3. `ALL_PROXY` contains credentials (has `@`)

## Prerequisites

Install `ncat` (from nmap) for full SOCKS5 proxy support:

```bash
brew install nmap
```

Without `ncat`, the plugin falls back to direct SSH which still works but
bypasses the sandbox's SOCKS5 proxy.

## License

Apache License 2.0. See [LICENSE](../LICENSE) for details.
