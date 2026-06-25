# sandbox-ssh-fix

Workaround for [anthropics/claude-code#70684](https://github.com/anthropics/claude-code/issues/70684).

## Detection and fix logic

The SessionStart hook (`scripts/fix-git-ssh.sh`) runs on every session start and
checks three conditions before acting:

| Condition | Variable | Check |
|-----------|----------|-------|
| Inside sandbox | `SANDBOX_RUNTIME` | `== 1` |
| Broken proxy | `GIT_SSH_COMMAND` | contains `nc -X 5` |
| Auth required | `ALL_PROXY` | contains `@` |

When all conditions are true, the script parses `ALL_PROXY`
(`socks5h://user:pass@host:port`) and writes a corrected `GIT_SSH_COMMAND` to
`$CLAUDE_ENV_FILE`.

The `ncat` path uses `127.0.0.1` instead of `localhost` because ncat resolves
`localhost` differently and the connection is refused.

SSH options `ControlMaster=no` and `ControlPath=none` are preserved from the
original command because SSH mux sockets aren't in the sandbox's allowed Unix
socket paths.
