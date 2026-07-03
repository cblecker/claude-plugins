---
name: finalize-plan
description: >-
  Review a plan for completeness before accepting — ensures key decisions,
  file names, commands, and constraints from the conversation are captured
  in the plan file so a fresh context can execute it.
---

## Pre-flight: confirm plan mode

Check your system context for a "Plan mode is active" reminder. If you are
**not** in plan mode, tell the user and stop — this skill only applies during
planning.

## Review the plan

Read the plan file (path is in the plan-mode system reminder).

Scan the conversation for details that a **fresh context with only the plan
file** would need to faithfully execute the work. Focus on:

- **Decisions** — choices the user made between alternatives
- **User corrections** — anything the user said "no, do it this way" about
- **Specific names** — files, functions, types, CLI flags, tools, or MCP
  resources the user referenced or you agreed to use
- **Commands** — exact build/test/run commands the user specified
- **Constraints** — ordering, compatibility, "don't touch X", style preferences

Skip anything a competent agent can rediscover from the codebase itself (line
numbers, import paths, boilerplate structure, surrounding code context).

## Report

If the plan already covers everything: say so in one sentence.

Otherwise list what's missing — brief bullets, each naming the gap and
suggesting what to add. Then offer to update the plan file with the missing
details.
