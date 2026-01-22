# CLAUDE.md

Personal Claude Code plugin marketplace

## Quick Reference

- Marketplace manifest at `.claude-plugin/marketplace.json`
- Plugins at repository root (flat structure), each with `.claude-plugin/plugin.json`
- Plugin directories: `skills/`, `hooks/`, `commands/`, `agents/`, `.mcp.json` (sparse - only include what's needed)
- `claude plugin validate .` - Validate marketplace
- `claude plugin validate ./<plugin-name>` - Validate specific plugin
- `npx markdownlint-cli2 "**/*.md"` - Verify markdown files
- Use kebab-case for all names
- Use `${CLAUDE_PLUGIN_ROOT}` for portable paths in hooks/MCP configs
- Marketplace entry format: `{"name": "plugin-name", "source": "./plugin-name", "strict": true}`

## Plugin Development

Use plugin-dev skills: `/plugin-dev:create-plugin`, `/plugin-dev:skill-reviewer`, `/plugin-dev:plugin-validator`

Documentation:
- [Create plugins](https://code.claude.com/docs/en/plugins)
- [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
