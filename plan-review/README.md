# Plan Review

Pre-flight review of plan files before context clear. Ensures key decisions,
file names, commands, and constraints from the conversation are captured in the
plan file so a fresh context can execute it.

## Usage

```text
/plan-review:finalize-plan
```

Invoke this while in plan mode, before accepting the plan and clearing context.

## How It Works

The skill runs three phases:

1. **Pre-flight** — confirms plan mode is active. If not, it stops immediately.
2. **Review** — reads the plan file and scans the conversation for details that
   would be lost on context clear. It checks five categories:
   - Decisions the user made between alternatives
   - User corrections ("no, do it this way")
   - Specific names (files, functions, types, CLI flags, tools, MCP resources)
   - Exact build/test/run commands the user specified
   - Constraints (ordering, compatibility, "don't touch X", style preferences)
3. **Report** — if the plan already covers everything, says so in one sentence.
   Otherwise lists gaps as brief bullets and offers to update the plan file.

The skill skips anything a competent agent can rediscover from the codebase
itself (line numbers, import paths, boilerplate structure).
