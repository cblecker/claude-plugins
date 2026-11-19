#!/bin/bash
# PreToolUse guard for rh-gworkspace MCP tools. Prints an "ask" decision for
# calls with side effects that reach other people or are hard to undo. Fails
# closed: any error also asks, since a crashed hook would let the call through.
set -euo pipefail

ask() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}
trap 'ask "rh-gworkspace guard could not inspect this call"' ERR

reason=$(jq -r '
  (.tool_name | sub("^mcp__plugin_rh-gworkspace_rh-gworkspace__"; "")) as $tool
  | (.tool_input // {}) as $in
  | if $tool == "send_gmail_message" then "Sends email immediately"
    elif $tool == "manage_drive_access" or $tool == "set_drive_file_permissions" then "Changes Drive sharing"
    elif $tool == "set_publish_settings" then "Changes form publishing"
    elif $tool == "manage_gmail_filter" then "Changes Gmail filters"
    elif $tool == "manage_event" and $in.action == "delete" then "Deletes a calendar event"
    elif $tool == "manage_event" and ($in.send_updates // "all") != "none" then "Notifies event attendees"
    elif $tool == "update_drive_file" and $in.trashed == true then "Moves a Drive file to trash"
    elif ($tool == "modify_gmail_message_labels" or $tool == "batch_modify_gmail_message_labels")
         and (($in.add_label_ids // []) | index("TRASH")) then "Moves email to trash"
    else empty end
')

if [[ -n "$reason" ]]; then
  ask "$reason"
fi
