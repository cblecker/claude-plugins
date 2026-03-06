# Git Plugin

## Architecture

A single SessionStart hook injects dynamic, project-aware git instructions into
every Claude Code session. No PreToolUse hooks, skills, or override mechanisms
are needed.

```text
SessionStart → git-instructions.sh → stdout (instructions injected as context)
                    ↓
              1. Detect mainline branch
              2. Detect conventional commits
              3. Detect fork setup
              4. Output instructions with detected values
```

### Prerequisite

Set `includeGitInstructions: false` in Claude Code settings to disable built-in
git instructions. This plugin replaces them with enhanced, project-aware versions.

### Single Script (`scripts/git-instructions.sh`)

Consolidates all detection logic (mainline branch, conventional commits, fork
setup) and outputs replacement git instructions via heredoc template.

- Pure bash, no external dependencies beyond git
- Graceful degradation: defaults to `main`, no conventions, no fork

### Detection

| Detection | Source |
|-----------|--------|
| Mainline branch | `git ls-remote --symref origin HEAD`, fallback to local |
| Conventional commits | commitlint config files, last 10 commits |
| Fork setup | `git remote get-url upstream` |

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

### Differences from built-in instructions

- `main/master` replaced with detected mainline branch name
- `gh pr create` replaced with `mcp__plugin_github_github__create_pull_request`
- `--no-gpg-sign` and `-c commit.gpgsign=false` merged into the safety protocol
  (built-in has these in a separate fragment)
- "If a hook fails, investigate and fix" merged inline (same)
- Conventional commits section added (conditional on detection)
- Fork workflow section added (conditional on upstream remote)
- Branch workflow section added
- `TodoWrite or Agent tools` references removed (not relevant to plugin context)
- Claude Code attribution line removed from PR body template
- Assisted-by trailer used instead of Co-Authored-By (follows Linux kernel AI attribution standard)
- Signed-off-by safety rule added (AI must never add DCO sign-off)

## Maintenance

Validate the plugin:

```bash
claude plugin validate ./git
```

Test the script standalone:

```bash
cd <any-git-repo> && bash /path/to/git/scripts/git-instructions.sh
```

Lint markdown:

```bash
npx markdownlint-cli2 --config ${CLAUDE_PROJECT_DIR}/.markdownlint-cli2.jsonc "git/**/*.md"
```
