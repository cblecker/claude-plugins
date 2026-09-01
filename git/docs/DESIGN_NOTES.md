# Git Plugin Design Notes

Maintainer documentation for the `git` plugin. User-facing documentation is in
[README.md](../README.md).

## Architecture

A single SessionStart hook injects dynamic, project-aware git instructions into
every Claude Code session. No PreToolUse hooks, skills, or override mechanisms
are needed.

```text
SessionStart → git-instructions.sh → stdout (instructions injected as context)
                    ↓                → CLAUDE_ENV_FILE (git config overrides)
              1. Detect mainline branch
              2. Detect conventional commits
              3. Detect fork setup
              4. Detect Kubernetes project
              5. Output instructions with detected values
              6. Write git config env overrides (if CLAUDE_ENV_FILE available)
```

### Prerequisite

Set `includeGitInstructions: false` in Claude Code settings to disable built-in
git instructions. This plugin replaces them with enhanced, project-aware versions.

### Single Script (`scripts/git-instructions.sh`)

Consolidates all detection logic (mainline branch, conventional commits, fork
setup, Kubernetes project) and outputs replacement git instructions via heredoc
template.

- Bash plus git and the POSIX text utilities every platform ships with (`sed`,
  `grep`, `awk`, `tr`) — mainline detection has piped through `grep`/`awk`/`sed`
  since the first version. No other runtime dependencies: nothing that has to be
  installed (`jq`, `yq`, python, node)
- Bash 3.2 compatible — macOS ships bash 3.2 as the system shell, and under
  `set -euo pipefail` a bash 4+ construct (`${var,,}`, `declare -A`, `mapfile`)
  aborts the hook before it emits any instructions
- Graceful degradation: defaults to `main`, no conventions, no fork

### Detection

| Detection | Source |
|-----------|--------|
| Mainline branch | `git ls-remote --symref origin HEAD`, fallback to local |
| Conventional commits | commitlint config files, last 10 commits |
| Fork setup | `git remote get-url upstream` |
| Kubernetes project | Owner of any remote URL matches `kubernetes` or `kubernetes-*` |

## Design Decisions

### Match built-in system prompt style

The output of `git-instructions.sh` matches the language, formatting, and
ordering of Claude Code's built-in git instructions (extracted from
`Piebald-AI/claude-code-system-prompts`) as closely as possible. Our
enhancements are layered on top as minimal diffs.

Specific style rules:

- Use plain text, not markdown backtick formatting, for command names and flags
  (matches how the built-in Bash tool description is written)
- Use `<example>` tags for code examples (matches built-in)
- Use `#` headings not `##` for major sections (matches built-in)
- Preserve the built-in's exact phrasing where possible; only change what we
  need to (detected mainline branch, MCP tools, conventional commits, fork setup)

### Settings conflict detection

Rather than scripted checks for `includeGitInstructions` or env vars, the output
includes an instruction telling Claude to check its own context for duplicate git
instructions and warn the user if both built-in and plugin instructions are
present. This keeps detection logic out of the script and lets Claude handle it
contextually.

### Kubernetes project conventions

Kubernetes projects want AI assistance disclosed on the pull request rather than
in commit trailers. When any remote is owned by `kubernetes` or a `kubernetes-*`
org, the script swaps two things:

- The `Assisted-by` trailer is dropped from the commit step, the HEREDOC example,
  and reinforced with a safety-protocol bullet prohibiting AI attribution
  trailers
- The PR section gains an AI usage disclosure requirement, pointing at the
  template's AI usage disclosure field when the repository has one

Detection matches the remote owner rather than the repository name so it covers
`kubernetes-sigs`, `kubernetes-csi`, and friends. Forks are covered through their
`upstream` remote. A false positive only makes Claude more conservative (omit a
trailer, add a disclosure line), so the prefix match is deliberately loose.

Owner extraction is one `owner_from_url` helper shared by the fork, fork-owner,
and Kubernetes detectors. It handles `https://`, `ssh://` (with or without a
port), `git://`, scp-style `git@host:owner/repo`, and local paths (absolute,
`../`-relative, or a bare `owner/repo`), with or without a `.git` suffix or
trailing slash, using parameter expansion only. The Kubernetes detector reads
`git remote get-url --all`, so a remote configured with several URLs is matched
on any of them, not just the first. Earlier versions ran a sed regex per
detector; the fork detectors did not strip a trailing slash and none of them
matched a bare relative path.

Output for non-Kubernetes repositories is byte-identical to the pre-Kubernetes
script, forks included: the blank line separating the fork and Kubernetes
sections is prepended to `KUBERNETES_SECTION` when a fork is detected rather than
appended to `FORK_SECTION`.

The existing "never add Signed-off-by" rule already covers Kubernetes' DCO
requirement, so it stays unconditional.

### Git config overrides via environment

Rather than modifying git config files (which the safety protocol forbids), the
script writes `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`
environment variables to `CLAUDE_ENV_FILE`. These override git settings for the
session without persisting to disk.

The entries use deferred expansion via a single-quoted heredoc: literal
`${GIT_CONFIG_COUNT:-0}` references are written to the file and expand at
source-time. This makes the approach additive — if another plugin or the parent
environment has already set entries, our entries append at the next available
index rather than overwriting.

Current overrides:

| Setting | Value | Reason |
|---------|-------|--------|
| `branch.autosetupmerge` | `false` | Prevents unintended tracking setup when creating branches |

### Differences from built-in instructions

- `main/master` replaced with detected mainline branch name
- `gh pr create` replaced with the GitHub MCP `create_pull_request` tool
- `--no-gpg-sign` and `-c commit.gpgsign=false` merged into the safety protocol
  (built-in has these in a separate fragment)
- "If a hook fails, investigate and fix" merged inline (same)
- Conventional commits section added (conditional on detection)
- Fork workflow section added (conditional on upstream remote)
- Kubernetes project section added (conditional on detection): no AI attribution
  trailers, AI usage disclosure in the PR body
- Branch workflow section added
- The upstream tool prohibition is spelled out tool-agnostically as
  `task-tracking tools (TaskCreate, TodoWrite) or the Agent tool`. Upstream
  renders it from `${GET_TODO_TOOL_FN}` and `${TASK_TOOL_NAME}`, where the todo
  getter resolves to `TaskCreate` or `TodoWrite` depending on whether the tasks
  feature is enabled and `TASK_TOOL_NAME` is the subagent tool (renamed `Agent`
  while the variable name stuck). Naming both keeps the rule correct in either
  configuration; a static hook cannot resolve the getter
- Claude Code attribution line removed from PR body template
- Assisted-by trailer used instead of Co-Authored-By (follows Linux kernel AI attribution standard)
- Signed-off-by safety rule added (AI must never add DCO sign-off)
- "NEVER commit directly to mainline" safety rule added (upstream has no equivalent)
- `-u` dropped from the push instruction; the flag errors in the Claude Code
  sandbox (upstream says "Push to remote with -u flag if needed")
- `gh` usage and the "Other common operations" section dropped in favour of the
  GitHub MCP tools (see the `github` plugin dependency)
- Git stash safety folded into the safety protocol (upstream keeps it in a
  separate System Prompt fragment)
- Post-staging secrets review folded into the safety protocol (upstream carries
  it in "Executing actions with care", outside the git instructions)
- Existing-PR update path and repository PR-template handling added to the PR
  section; upstream supplies these via runtime-injected variables
  (`REPO_PR_TEMPLATE_CONTEXT_BLOCK`, `gh pr edit` with no selector) that a static
  hook cannot render

## Upstream Alignment

Last reviewed against [`Piebald-AI/claude-code-system-prompts`][ccsp] at
**v2.1.233** (2026-08-15). Previous full alignment was v2.1.126.

The upstream source of truth is
`system-prompts/tool-description-bash-git-commit-and-pr-creation-instructions.md`;
its prose was unchanged between v2.1.126 and v2.1.233 (only template-variable
plumbing moved). Relevant adjacent fragments and what we did with them:

| Upstream change | Version | Disposition |
|-----------------|---------|-------------|
| System Prompt: Shared git stash safety | 2.1.198 | Adopted, condensed into the safety protocol |
| Executing actions with care — review a broad `git add`, `git status` before discarding work | 2.1.199–2.1.200 | Adopted as two safety-protocol bullets |
| Agent Prompt: Quick PR creation — repo PR-template context | 2.1.205 | Adopted as a PR-template check in the PR section |
| Agent Prompt: Quick PR creation — `gh pr edit` with no selector updates the branch's existing PR | 2.1.229 | Adopted as an `update_pull_request` path |
| Agent Prompt: Quick git commit / Pull request creation hardening | 2.1.229 | Already covered; our instructions carried these rules |
| Tool Description: Bash (pre-commit skill checks) | 2.1.225 | **Not adopted.** Requires a runtime-rendered list of the session's applicable verify/simplify/code-review skills; a static hook cannot name them, and a generic "run your checks" restatement is weaker than the harness version, which still fires when it applies |
| Tool Description: PowerShell (git guidance) | 2.1.229 | **Not adopted.** The hook is a bash script emitting HEREDOC examples; PowerShell here-string variants would only matter for a non-bash host that cannot run the hook anyway |
| Background/forked worktree isolation guidance | 2.1.198–2.1.221 | **Not adopted.** Harness-level session behavior, not repository git workflow |

[ccsp]: https://github.com/Piebald-AI/claude-code-system-prompts

## Maintenance

Validate the plugin:

```bash
claude plugin validate ./git
```

Test the script standalone:

```bash
cd <any-git-repo> && bash /path/to/git/scripts/git-instructions.sh
```

Lint the script (clean at default severity):

```bash
uvx --from shellcheck-py shellcheck git/scripts/git-instructions.sh
```

Lint markdown:

```bash
npx markdownlint-cli2 --config ${CLAUDE_PROJECT_DIR}/.markdownlint-cli2.jsonc "git/**/*.md"
```
