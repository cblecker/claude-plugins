# CLAUDE.md

Personal Claude Code plugin marketplace

## Architecture

```text
.
├── .claude-plugin/
│   └── marketplace.json      # Marketplace manifest (lists all plugins)
├── git/                       # Custom plugin: git workflows & safety
├── gofmt/                     # Custom plugin: Go formatting hooks
├── github/                    # MCP wrapper: GitHub tools
├── gws/                       # Custom plugin: Google Workspace CLI skills
├── sequential-thinking/       # MCP wrapper: chain-of-thought reasoning
└── CLAUDE.md
```

Each plugin directory contains `.claude-plugin/plugin.json` and its own components
(skills, hooks, agents, MCP configs). Plugins are at the repository root in a flat
structure.

## Commands

| Command | Purpose |
|---------|---------|
| `claude plugin validate .` | Validate marketplace |
| `claude plugin validate ./<plugin-name>` | Validate specific plugin |
| `npx markdownlint-cli2 --config ${CLAUDE_PROJECT_DIR}/.markdownlint-cli2.jsonc "**/*.md"` | Lint markdown files |
| `uvx claudelint --strict` | Lint plugin |

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
- When editing plugin files (other than README.md or CLAUDE.md), bump the version in that plugin's `.claude-plugin/plugin.json`
- Use plugin-dev skills: `/plugin-dev:create-plugin`, `/plugin-dev:skill-reviewer`, `/plugin-dev:plugin-validator`

## Documentation

- [Create plugins](https://code.claude.com/docs/en/plugins)
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
