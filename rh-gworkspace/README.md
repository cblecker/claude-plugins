# rh-gworkspace

Red Hat's hosted Google Workspace MCP server, plus a hook that asks before risky calls.

## Components

### MCP Server

HTTP-based MCP server at `gworkspace.corp.redhat.com`, covering Gmail, Calendar, Drive, Docs,
Sheets, Slides, Forms, Tasks and Contacts under your Red Hat Google account. It requires the
Red Hat VPN. Authenticate with the `/mcp` command.

Write tools act immediately: mail sends, event changes notify attendees, and sharing changes
take effect at once.

### Guard Hook

A PreToolUse hook asks for confirmation, including in auto mode, before calls that:

- send, reply to or forward email
- change Drive sharing, Gmail filters or form publishing
- delete a calendar event, or create or change one without `send_updates: "none"`
- move a Drive file or email to trash

If the hook can't inspect a call (for example, `jq` is missing), it asks anyway.

To have the auto mode classifier treat these as risky too, add to `~/.claude/settings.json`:

```json
{
  "autoMode": {
    "soft_deny": [
      "$defaults",
      "Sending email or changing Google Workspace sharing without the user explicitly asking for it"
    ]
  }
}
```
