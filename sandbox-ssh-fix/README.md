# sandbox-ssh-fix

Workaround for broken git-over-SSH in the Claude Code sandbox on macOS.

## Problem

The Claude Code sandbox injects `GIT_SSH_COMMAND` with a `ProxyCommand` using
BSD `nc -X 5` for SOCKS5 proxying. On macOS, `nc` doesn't support SOCKS5
authentication, and the proxy requires auth — breaking all git-over-SSH
operations (`git fetch`, `git push`, `git pull`).

Tracked upstream: <https://github.com/anthropics/claude-code/issues/70684>

## How it works

This plugin ships an `nc` wrapper (`bin/nc`) that intercepts SOCKS5 proxy calls
and delegates to `ncat` with the auth credentials parsed from `ALL_PROXY`.

### Flow

1. SessionStart hook prepends `plugin/bin/` to `PATH` via `CLAUDE_ENV_FILE`
2. Sandbox injects `GIT_SSH_COMMAND` containing `nc -X 5 -x localhost:PORT %h %p`
3. SSH runs ProxyCommand, shell finds `bin/nc` wrapper first via PATH
4. Wrapper checks for the SOCKS5 pattern (`-X 5 -x`), reads `ALL_PROXY`
   (available at runtime in sandbox), and delegates to `ncat` with `--proxy-auth`
5. Non-SOCKS5 calls or missing `ncat` fall through to `/usr/bin/nc`

The wrapper uses `127.0.0.1` instead of `localhost` because `ncat` resolves
`localhost` differently and the connection is refused.

## Prerequisites

Install `ncat` (from nmap) for full SOCKS5 proxy support:

```bash
brew install nmap
```

Without `ncat`, the plugin falls back to the system `nc` which will fail for
authenticated SOCKS5 proxies.

## License

Apache License 2.0. See [LICENSE](../LICENSE) for details.
