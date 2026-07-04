# Claude Code Plugins

Personal collection of Claude Code plugins by Christoph Blecker.

This repository serves as a custom plugin marketplace for [Claude Code](https://claude.com/claude-code), providing enhanced capabilities through plugins that extend Claude's functionality with custom workflows, MCP servers, and automation.

## Installation

Add this marketplace to your Claude Code installation:

```bash
claude plugin marketplace add cblecker/claude-plugins
```

## Available Plugins

| Plugin                                       | Description                                                                                      |
|----------------------------------------------|--------------------------------------------------------------------------------------------------|
| [git](./git)                                 | Dynamic git instructions via SessionStart hook with mainline detection, conventional commits, fork handling, and safety guardrails |
| [github](./github)                           | GitHub MCP server with all toolsets enabled, always loaded for immediate tool availability        |
| [pr-review-toolkit](./pr-review-toolkit)     | Comprehensive PR review board using shared workflow context                                      |
| [gws](./gws)                                 | Google Workspace CLI skills for Gmail, Calendar, Drive, Docs, Sheets, Slides, and Meet          |
| [rh-dataverse](./rh-dataverse)               | Red Hat Dataverse MCP server                                                                    |
| [sandbox-ssh-fix](./sandbox-ssh-fix)         | Fixes git-over-SSH in the Claude Code sandbox on macOS by replacing the broken BSD nc SOCKS5 proxy |
| [plan-review](./plan-review)                 | Pre-flight review of plan files before context clear                                             |
| [x-twitter-scraper](./x-twitter-scraper)     | Xquik X/Twitter API, MCP, SDK, webhook, export, and monitor workflow planning                    |

## License

This repository is licensed under the Apache License 2.0. See [LICENSE](./LICENSE) for details.
