#!/usr/bin/env bash
set -euo pipefail

# Only run inside the Claude Code sandbox
[[ "${SANDBOX_RUNTIME:-}" == "1" ]] || exit 0

# Only fix the broken BSD nc SOCKS5 proxy pattern
[[ "${GIT_SSH_COMMAND:-}" == *"nc -X 5"* ]] || exit 0

# Only needed when ALL_PROXY has credentials (contains @)
[[ "${ALL_PROXY:-}" == *"@"* ]] || exit 0

# CLAUDE_ENV_FILE is required to export the fix
[[ -n "${CLAUDE_ENV_FILE:-}" ]] || exit 0

# Parse ALL_PROXY: socks5h://user:pass@host:port
proxy_auth="${ALL_PROXY#*://}"  # user:pass@host:port
proxy_auth="${proxy_auth%@*}"   # user:pass
proxy_port="${ALL_PROXY##*:}"   # port

if command -v ncat >/dev/null 2>&1; then
  cat >> "${CLAUDE_ENV_FILE}" <<ENVEOF
export GIT_SSH_COMMAND='ssh -o ControlMaster=no -o ControlPath=none -o '\''ProxyCommand=ncat --proxy-type socks5 --proxy-auth ${proxy_auth} --proxy 127.0.0.1:${proxy_port} %h %p'\'''
ENVEOF
  echo "SessionStart:startup hook success: sandbox-ssh-fix: replaced broken BSD nc with ncat for SOCKS5 proxy auth"
else
  echo "export GIT_SSH_COMMAND='ssh -o ControlMaster=no -o ControlPath=none'" >> "${CLAUDE_ENV_FILE}"
  echo "SessionStart:startup hook success: sandbox-ssh-fix: ncat not found, bypassing SOCKS5 proxy (using direct SSH)"
fi
