---
name: review-pr
description: >-
  Conduct a comprehensive PR review and return an interactive review board
disable-model-invocation: true
arguments: [pr-url]
argument-hint: <github-pr-url>
allowed-tools:
  - Workflow
  - mcp__plugin_github_github__pull_request_read
  - AskUserQuestion
---

# PR Review: $pr-url

## Constraints

Do not generate ad-hoc scripts to process data. Use only the tools listed in
allowed-tools. The workflow and workflow-spawned agents must use GitHub read
tools only. Do not post, draft pending reviews, add comments, submit reviews, or
call GitHub write tools from this skill.

Workflow return values and MCP results are structured JSON. Read them directly
instead of shelling out to parse or format them.

## Phase 1: Launch Analysis Workflow

Parse `$pr-url` to extract owner, repo, and PR number from the GitHub URL
pattern `https://github.com/{owner}/{repo}/pull/{number}`.

Invoke the Workflow tool with:

- `scriptPath`: `${CLAUDE_SKILL_DIR}/review-pr.js`
- `args`:
  - `owner`
  - `repo`
  - `pullNumber`

The workflow owns PR collection and reviewer selection. Do not prefetch PR
metadata, changed files, diffs, or review threads in the skill conversation.

The workflow returns a review board:

```json
{
  "recommendedToPost": [],
  "possiblePlusOnes": [],
  "partialOverlaps": [],
  "discussionOnly": [],
  "alreadyCovered": [],
  "discarded": [],
  "positiveObservations": [],
  "actionPlan": {
    "critical": [],
    "important": [],
    "suggestions": [],
    "recommendedNextAction": "draft recommended findings"
  },
  "coverageSummary": {
    "scope": "Collected source, tests, docs, and existing review threads.",
    "largePrNotes": []
  },
  "pr": {
    "owner": "org",
    "repo": "repo",
    "number": 123
  },
  "summary": {},
  "reviewMeta": {}
}
```

## Phase 2: Present Review Board

Present the review board before asking what to do next. Keep the board concise
but do not hide important groups.

Use this order:

1. Review heading: `owner/repo#number` and PR title when available.
2. Coverage summary:
   - scope
   - large PR notes, if present
   - selected reviewers and file/thread counts from `reviewMeta`
3. Action plan:
   - critical
   - important
   - suggestions
   - recommended next action
4. Findings grouped by outcome:
   - recommended to post
   - possible plus-ones
   - partial overlaps
   - worth discussing, not posting
   - already covered
   - discarded or weak findings, summarized if long
5. Strengths or positive observations.

For each finding, include:

- stable id
- location
- lens
- title
- confidence
- claim
- evidence
- why it matters
- suggested fix or next step
- existing review overlap rationale when present

## Phase 3: Ask For The Next Review Action

After presenting the board, ask via AskUserQuestion:

> "What should we do next? You can reply with commands like 'draft
> recommended', 'explain F2', 'challenge F3', 'show covered', 'skip F4', or
> 'cancel'."

Free-text response, not option buttons.

Respond to follow-up questions using the review board evidence and uncertainty.
Draft selected comments only as text in the conversation. Do not post them.
