---
name: review-pr
description: >-
  Conduct a comprehensive PR review of the current checkout and open an
  interactive review board in the review pane
disable-model-invocation: true
allowed-tools:
  - mcp__pr-review-toolkit__prepare_review
  - Workflow
---

# PR Review

Run from a checkout of the PR head (`claude --worktree '<pr-url>'`, `gh pr
checkout N`, or the author's up-to-date branch). Requires Claude Code 2.1.287+
with the pr-review-toolkit mod loaded.

1. Call `mcp__pr-review-toolkit__prepare_review`. If it returns `error`, report
   it verbatim and stop.
2. Call the Workflow tool with `name: pr-review-toolkit:review-pr-analysis` and
   `args: { pr: <handle from step 1> }`. Pass nothing else. The workflow script
   is `review-pr.js` beside this file; always launch it by name, never by path.
3. Stop. The review pane shows progress and the board; when it asks you to
   draft comments, follow `${CLAUDE_SKILL_DIR}/references/drafting.md`.
