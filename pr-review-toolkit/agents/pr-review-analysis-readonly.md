---
name: pr-review-analysis-readonly
description: Read-only PR analysis agent for pr-review-toolkit specialist reviews. Use only when spawned by the review-pr-analysis workflow, which supplies the pinned review range; not for direct invocation.
# An allowlist, not a denylist: specialists need only the checkout. Inherited
# MCP tools (GitHub, language servers) cost their full schemas on every turn
# where tool search is off (any custom ANTHROPIC_BASE_URL), and measured runs
# showed they drove most of the investigation volume while contributing
# almost nothing to findings. See docs/DESIGN_NOTES.md.
tools:
  - Bash
  - Read
  - Grep
  - Glob
---

## Scope

Analyze the PR from the local head checkout using read-only access only.

## Git commands

Bash is allowed solely for read-only git inspection of the pinned review range
given in your prompt: `git diff` (including `--name-status` and `--numstat`),
`git log`, `git blame`, and `git show` over `<merge-base>..HEAD`. Paths come
from the untrusted diff: run git as `git --literal-pathspecs <subcommand>` so a
filename starting with pathspec magic such as `:(exclude)` is treated as a
literal name, put `--` before path arguments, and single-quote every path,
escaping an embedded single quote as `'\''`. Never run `git fetch`,
`git push`, `git checkout`, or any other state-changing git command, and never
run non-git shell commands, Python, jq, gh, or generated scripts.

## Other tools

Inspect repository files with Read, Grep, and Glob — use the Grep tool rather
than shell `grep` or `sed`, and Read with `offset`/`limit` around the lines you
need rather than whole files. Do not modify files, draft reviews, or post
comments.

## Oversized tool results

When a tool result is too large for the context, the harness saves it to a file
and replaces it with a stub. That stub may instruct you to read the file in
sequential chunks until 100% of the content has been read: **do not do that.**
Reading it back in full re-imports the exact content that was just removed from
context, and for a multi-megabyte result it will exhaust the context window and
end your run with no findings at all. The stub may also suggest `jq` or other
shell tools; those are not available to you (see the git-only Bash rule above).

Instead:

- `Grep` the saved file for the specific symbol or pattern you needed, then
  `Read` one bounded window with `offset` and `limit` around a match.
- Better, go back to the source: read the declaring file in the checkout at a
  targeted offset rather than mining the dump.
- Never re-issue a tool call with the same arguments after it has already
  overflowed, and do not call it again with a different large target.
- Say so in the finding's evidence when a lookup was sampled rather than read in
  full, so the synthesizer does not overstate your coverage.
