# CLAUDE.md

Personal Claude Code plugin marketplace, with a native Codex PR review port

## Architecture

```text
.
├── .claude-plugin/
│   └── marketplace.json      # Marketplace manifest (lists all plugins)
├── git/                       # Custom plugin: git workflows & safety
├── github/                    # MCP wrapper: GitHub tools, PR triage skill
├── gws/                       # Vendored upstream skills: Google Workspace CLI
├── plan-review/               # Custom plugin: plan-file pre-flight review
├── pr-review-toolkit/         # Claude and Codex PR review workflows
│   ├── .claude-plugin/        # Claude manifest
│   ├── .codex-plugin/         # Codex manifest (same version)
│   ├── skills/               # Claude skills and coordinator
│   └── codex/                # Native Codex skill, launcher, and tests
├── rh-dataverse/              # MCP wrapper: Red Hat Dataverse, Rover people skill
├── sandbox-ssh-fix/           # Custom plugin: macOS sandbox git-over-SSH workaround
└── CLAUDE.md
```

Each plugin directory contains `.claude-plugin/plugin.json` and its own components
(skills, hooks, agents, MCP configs). Plugins are at the repository root in a flat
structure. The PR review toolkit also has a `.codex-plugin/plugin.json` with an
explicit `./codex/skills/` root. Its marketplace entry supports both clients;
Claude and Codex implementations intentionally evolve independently.

## Commands

| Command | Purpose |
|---------|---------|
| `claude plugin validate .` | Validate marketplace |
| `claude plugin validate ./<plugin-name>` | Validate specific plugin |
| `npx markdownlint-cli2 --config ${CLAUDE_PROJECT_DIR}/.markdownlint-cli2.jsonc "**/*.md"` | Lint markdown files |
| `uvx skillsaw --strict` | Lint plugin |
| `node --test pr-review-toolkit/codex/test/*.test.mjs` | Test Codex launcher |
| `node pr-review-toolkit/codex/bin/validate.mjs --install` | Validate Codex discovery in a temporary installation |
| `codex-review-pr <PR_URL>` | Prepare a separate worktree and launch a native Codex review |

## Adding a Plugin

1. Create plugin directory at repository root using `/plugin-dev:create-plugin`
2. Add entry to `.claude-plugin/marketplace.json`:

   ```json
   {"name": "plugin-name", "source": "./plugin-name", "strict": true}
   ```

3. Update `README.md` Available Plugins table
4. Validate: `claude plugin validate .` and `claude plugin validate ./<plugin-name>`

## Conventions

- Use kebab-case for all names
- Use `${CLAUDE_PLUGIN_ROOT}` for portable paths in hooks/MCP configs
- When editing plugin files (other than README.md or CLAUDE.md), bump the version in
  that plugin's `.claude-plugin/plugin.json` following semver:
  - **patch**: bug fixes, typo corrections, minor wording changes
  - **minor**: new skills, commands, hooks, agents, or backward-compatible behavior changes
  - **major**: breaking changes (renamed/removed skills, changed hook behavior, restructured plugin)
- For `pr-review-toolkit`, keep `.claude-plugin/plugin.json` and
  `.codex-plugin/plugin.json` versions equal.
- Only bump once per PR branch. Before bumping, check `git diff main -- <plugin>/.claude-plugin/plugin.json`
  to see if the version was already bumped. Skip if it was, unless the accumulated
  changes now warrant a higher semver level (e.g., patch already bumped but a new
  skill was added — upgrade to minor)
- Use plugin-dev skills: `/plugin-dev:create-plugin`, `/plugin-dev:skill-reviewer`, `/plugin-dev:plugin-validator`
- `.skillsaw.yaml` pins `version` to the skillsaw release the lint workflows run. Rules newer
  than that version are silently skipped, so when Dependabot bumps the `stbenjam/skillsaw`
  actions, bump `version` to match and re-run `uvx skillsaw --strict`. Deliberate `` !`command` ``
  preflight lines in skills must be added verbatim to the `security-dynamic-context` allowlist
- CodeRabbit auto-review is disabled (`reviews.auto_review.enabled: false` in
  `.coderabbit.yaml`). Reviews are rate-limited, so request one manually with an
  `@coderabbitai review` comment only when the branch is ready — not after every push
- When addressing automated review feedback on a PR (Copilot, CodeRabbit): wait until
  every reviewer has finished reviewing the current head, then push fixes for all
  findings as a single commit — one push per review round, not one per reviewer

## Codex Review Maintenance

The launcher fetches over HTTPS, including for clones whose remotes use SSH.
Private repositories need working Git HTTPS authentication in addition to `gh`.
Source the launcher after the authenticated `gh` and `codex` aliases. Preparation
gets a token through the shell's `gh auth token` and scopes it to its process.
Keep simultaneous preparation independent of shared `FETCH_HEAD` and leave the
starting checkout untouched. Keep review worktrees in private system temporary
directories and clean them up when the session exits or preparation fails. Use
non-forced removal and report retained paths.

Analysis uses native subagents and normal Codex session settings. Review-only
instructions do not enforce per-stage tool or credential isolation. Keep the
launcher small; do not reintroduce a worker pool, custom profile, CLI version
gate, or filesystem denial probes. The conversation holds the review board and
drafts. Posting requires approval of the exact preview and a PR head check
immediately before every write.

## Documentation

- [Create plugins](https://code.claude.com/docs/en/plugins)
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
