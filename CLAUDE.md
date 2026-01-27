# CLAUDE.md

Personal Claude Code plugin marketplace

## Quick Reference

- Marketplace manifest at `.claude-plugin/marketplace.json`
- Plugins at repository root (flat structure), each with `.claude-plugin/plugin.json`
- Marketplace entry format: `{"name": "plugin-name", "source": "./plugin-name", "strict": true}`
- Use plugin-dev skills: `/plugin-dev:create-plugin`, `/plugin-dev:skill-reviewer`, `/plugin-dev:plugin-validator`
- Sparse format for plugin directories
- `claude plugin validate .` - Validate marketplace
- `claude plugin validate ./<plugin-name>` - Validate specific plugin
- `npx markdownlint-cli2 --config ${CLAUDE_PROJECT_DIR}/.markdownlint-cli2.jsonc "**/*.md"` - Verify markdown files
- `uvx claudelint --strict` - Lint plugin
- Use kebab-case for all names
- Use `${CLAUDE_PLUGIN_ROOT}` for portable paths in hooks/MCP configs

## Documentation

- [Create plugins](https://code.claude.com/docs/en/plugins)
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
