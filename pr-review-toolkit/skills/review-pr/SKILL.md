---
name: review-pr
description: >-
  Conduct a comprehensive PR review and return an interactive review board
disable-model-invocation: true
arguments: [pr-url]
argument-hint: <github-pr-url>
allowed-tools:
  - Workflow
  - AskUserQuestion
  - mcp__plugin_github_github__pull_request_read
  - mcp__plugin_github_github__pull_request_review_write
  - mcp__plugin_github_github__add_comment_to_pending_review
---

# PR Review: $pr-url

## Constraints

Use only the tools listed in `allowed-tools`. Do not generate ad-hoc scripts to
process GitHub data. Workflow return values and MCP responses are structured
JSON; read them directly.

The bundled workflow and workflow-spawned agents are analysis-only. They must
use GitHub read tools only and must not draft pending reviews, add comments,
submit reviews, resolve threads, or call GitHub write tools.

The skill conversation may draft comment text after the user selects findings.
GitHub write tools may be used only after an exact preview and explicit final
posting approval from the user.

## Launch Analysis Workflow

Parse `$pr-url` to extract owner, repo, and PR number from:

```text
https://github.com/{owner}/{repo}/pull/{number}
```

Invoke the Workflow tool with:

- `scriptPath`: `${CLAUDE_SKILL_DIR}/review-pr.js`
- `args`:
  - `owner`
  - `repo`
  - `pullNumber`

The workflow owns PR collection, reviewer selection, specialist analysis, and
review-board synthesis. Do not prefetch PR metadata, changed files, diffs, or
review threads in the skill conversation.

The workflow returns a review board with this shape:

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
    "recommendedNextAction": "review recommended postable findings"
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

## Present Review Board

Present the review board before drafting or posting anything. Keep it concise,
but do not hide important groups.

Use this order:

1. Review heading: `owner/repo#number` and PR title when available.
2. Coverage summary:
   - `coverageSummary.scope`
   - `coverageSummary.largePrNotes`, if present
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
5. Positive observations.

For each finding shown in detail, include:

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

## Ask What To Do Next

After presenting the board, ask with `AskUserQuestion`:

```text
What should we do next? You can reply with commands like "draft recommended",
"draft F1 F3", "plus-one F2", "explain F4", "challenge F5", "show covered",
"skip F6", "post selected", or "cancel".
```

Use a free-text response, not option buttons. Interpret natural language
flexibly, but preserve the review board ids as the stable selection handles.

Support these actions:

- `draft recommended`: draft all `recommendedToPost` findings.
- `draft F1 F3`: draft selected findings.
- `plus-one F2`: draft a concise endorsement for an overlap finding.
- `skip F4`: mark a finding as intentionally omitted in the conversation.
- `explain F5`: explain the evidence, uncertainty, and tradeoffs.
- `challenge F6`: reassess the finding using the board evidence and state any
  uncertainty plainly.
- `show covered`: show `alreadyCovered` and relevant overlap rationale.
- `cancel`: stop without drafting or posting.
- `post selected`: only continue if there is already an approved preview;
  otherwise draft and preview first.

## Draft Selected Comments

Draft comments only in the conversation. Do not call GitHub write tools during
drafting.

Drafts should:

- sound like the user wrote them
- be concise and actionable
- avoid boilerplate, severity labels, and AI markers
- include enough context for the PR author to act
- avoid duplicating comments already covered elsewhere
- distinguish blocking concerns from optional suggestions

For possible plus-ones and partial overlaps, make the overlap explicit. Draft a
plus-one only when the finding's `existingReviewOverlap` indicates that an
endorsement or additional detail is useful.

Prefer line comments for findings with a concrete changed-file location. Put
findings without a valid line location in the review body.

Choose the proposed review event from the selected findings:

- `REQUEST_CHANGES` only when at least one selected finding is a serious
  correctness or blocking concern.
- `COMMENT` for non-blocking feedback, suggestions, plus-ones, or discussion.

## Preview And Confirm

Before posting, show an exact preview:

- each line comment with finding id, path, line, and body
- review body text for non-line findings
- proposed review event: `COMMENT` or `REQUEST_CHANGES`
- any selected findings intentionally omitted from posting

Ask for explicit final approval with `AskUserQuestion`. Accept approval only
when the user clearly confirms posting the preview, such as "post this",
"approved", or "submit". If the user requests edits or removals, update the
preview and ask for approval again.

## Post Approved Review

Use GitHub write tools only in this final approved step.

If the approved preview has line comments:

1. Create a pending review with
   `mcp__plugin_github_github__pull_request_review_write`.
2. Add approved line comments with
   `mcp__plugin_github_github__add_comment_to_pending_review`.
3. Submit the pending review with
   `mcp__plugin_github_github__pull_request_review_write` using the approved
   event and review body.

If the approved preview has only review-body text, submit the review body with
`mcp__plugin_github_github__pull_request_review_write` using the approved event.

If a line comment cannot be added because the location is invalid for the PR
diff, move that text into the review body, show the revised preview, and ask for
approval again before posting.
