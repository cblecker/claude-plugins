#!/usr/bin/env bash
set -euo pipefail

[[ -n "${CLAUDE_ENV_FILE:-}" ]] || exit 0

echo "export PATH=\"${CLAUDE_PLUGIN_ROOT}/bin:\${PATH}\"" >> "${CLAUDE_ENV_FILE}"
echo "SessionStart:startup hook success: sandbox-ssh-fix: added nc wrapper to PATH"
