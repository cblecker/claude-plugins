---
name: address-pr-feedback
description: >-
  Systematically collect, analyze, score, and address pull request review
  feedback, then post reply comments
disable-model-invocation: true
user-invocable: true
arguments: [--interactive]
argument-hint: [--interactive]
---

# Address PR Feedback

Systematically collect, analyze, score, and plan execution for pull request
review feedback, then post reply comments to GitHub.

## Phase 0: Branch Validation

**Validate branch first:**

- Run `git branch --show-current` to get the current branch
- Run `git ls-remote --symref origin HEAD 2>/dev/null | grep "^ref:" | awk '{print $2}' | sed 's|refs/heads/||'` to get the mainline branch
- If the current branch matches the mainline branch:
  - Display: "Error: You're on the mainline branch. Please checkout a feature branch and retry this skill."
  - Stop execution

**Then ensure plan mode is active:**

- If plan mode is not already active, call `EnterPlanMode` and wait for user
  approval
- If plan mode is already active (check for "Plan mode is active" in system
  context), proceed directly

## Phase 1: Feedback Collection

Check if the argument contains `--interactive`. If it does, use the
**interactive collection** path. Otherwise, use the **auto-fetch** path.

### Auto-Fetch Path (Default)

1. **Detect PR from current branch:**
   - Run `git remote get-url origin` and extract owner/repo
     (strip protocol prefix, `.git` suffix, and hosting domain)
   - Run `git branch --show-current` to get the branch name
   - Determine if this is a fork workflow:
     - Run `git remote get-url upstream 2>/dev/null` — if it succeeds, this is
       a fork workflow; extract the upstream owner/repo
   - Find the open PR:
     - Fork workflow: use `list_pull_requests` with `state: "open"` and
       `head: "<fork-owner>:<branch>"`, scoped to the upstream owner/repo
     - Non-fork workflow: use `list_pull_requests` with `state: "open"` and
       `head: "<owner>:<branch>"`, scoped to the owner/repo
   - If no PR found, display:
     "Error: No open PR found for branch `<branch>`. Push and open a PR first,
     or use `--interactive` to paste feedback manually."
   - Stop execution if no PR found

2. **Fetch all comments** using `pull_request_read` on the found PR:
   - `get_reviews` — review bodies and review events
   - `get_review_comments` — inline review comments with threads
   - `get_comments` — issue-style conversation comments

   Include all comments — no bot filtering, no trust filtering. The scoring
   phase handles relevance naturally.

3. **Normalize** each comment into a structured item:
   - `text` — comment body
   - `author` — GitHub username
   - `file` / `line` — file path and line number (inline comments only; null
     for others)
   - `commentId` — numeric comment ID (for reply posting)
   - `threadId` — thread node ID (inline comments) or null
   - `type` — `"review"` | `"inline"` | `"conversation"`

### Interactive Collection Path (`--interactive`)

Display: "Ready to accept feedback items. Say 'done' when finished."

Loop until user says "done":

1. Receive user input
2. Launch Haiku agent to parse:
   - Fetch any GitHub comment URLs (use GitHub MCP tools)
   - Extract feedback text
   - Extract author (if available)
   - Extract file/line location (if available)
   - Normalize into structured format with `commentId`, `threadId`, and `type`
     fields (set to null if not available from pasted content)
3. Acknowledge: "Recorded item [N]: [brief summary]"
4. Continue loop

Store all items in conversation context.

## Phase 2: Analysis & Scoring

Before analyzing, **deduplicate related items.** Multiple comments often
address the same underlying concern (e.g., two reviewers flag the same issue,
or one reviewer comments on both the declaration and usage of the same
problem). Group these into a single logical item — track all associated
`commentId`/`threadId` values so replies can be posted to each thread in
Phase 6.

**For 5 or fewer items**, analyze and score inline — the context is small
enough that agents add latency without improving quality.

**For 6+ items, launch parallel Sonnet agents** (one per feedback item, or
batched 3-5 items if many):

Each agent prompt:

```text
Analyze this PR feedback item:
[item details]

Read relevant code context (minimal - only affected files/lines).
Check CLAUDE.md for applicable guidance.

Return:
- Validity: Is this feedback correct and still applicable?
- Impact: What's the practical effect? (bug/enhancement/style)
- Effort: Implementation cost (S/M/L)
- Guidance: Is it backed by CLAUDE.md or project standards?
- Recommended action: Implement/modify/reject/discuss
- Draft reply: Brief explanation for reviewer (e.g., "Addressed in
  [commit/location]" or "Fixed by [change description]")

Flag false positives:
- Code no longer present
- Already addressed in subsequent commits
- Conflicts with other feedback items
- Based on outdated PR state
```

**Launch parallel Haiku agents** for scoring (one per item):

Each scoring agent receives the analysis and applies this rubric (0-100
scale):

| Score | Interpretation |
|-------|----------------|
| 0-25 | Invalid: feedback doesn't apply, code doesn't have this issue, or already fixed; may be misunderstanding or based on outdated PR state |
| 26-50 | Valid but minor: real issue but stylistic preference, nitpick, or low practical impact; not backed by project standards |
| 51-75 | Important: verified real issue with practical impact; affects functionality or code quality meaningfully |
| 76-100 | Critical: definitely correct, high impact, affects users or core functionality, or explicitly violates CLAUDE.md/standards |

**Scoring factors:**

- Validity (40%): Is feedback correct and still applicable to current code
  state?
- Impact (30%): Practical effect on functionality, users, or code quality
- Effort (20%): Implementation cost (inverse — lower effort = higher score
  contribution)
- Guidance backing (10%): Explicitly mentioned in CLAUDE.md or project
  standards

Return score with rationale.

## Phase 3: Action Confirmation

Order items by score (highest first).

For each item, use `AskUserQuestion`:

```text
Question: "Item [N]: [summary] - Score: [X] - Recommended: [action]. Confirm course of action?"
Header: "Item [N]"
Options:
  - "Implement as suggested" (description: Apply the feedback exactly as stated)
  - "Implement differently" (description: Address the concern but with a different approach - will specify)
  - "Reject" (description: Do not address this feedback - will provide reason)
  - "Discuss with reviewer" (description: Need clarification before deciding)
```

Record confirmed action for each item.

## Phase 4: Plan Generation

Use Haiku agent to write plan file with this structure:

```markdown
# PR Feedback Execution Plan

Total items: [count]

## Execution Instructions

**IMPORTANT:** Use TaskCreate to create a task for each item below FIRST before
implementing any changes.

1. Create tasks for all items
2. Implement in order (highest score first)
3. Mark tasks complete as you go
4. Verify all changes before re-requesting review

## Feedback Items

### Item 1: [summary]
- **Score:** [X]
- **Action:** [confirmed action]
- **Files:** [affected files with paths]
- **Implementation:**
  - [Step 1]
  - [Step 2]
  - [...]
- **Draft reply:** [Brief comment explaining how this was addressed]

### Item 2: [summary]
...

## Verification Checklist

- [ ] All tasks created via TaskCreate
- [ ] All implementations complete
- [ ] Tests pass
- [ ] Code follows project standards
- [ ] Ready for re-review
```

## Phase 5: Exit Plan Mode

Call `ExitPlanMode` to signal planning is complete and request user approval.

After user approval, execution begins:

1. Tasks are created using TaskCreate
2. Each item is implemented following the plan
3. Tasks are marked complete as work progresses

## Phase 6: Reply Posting

After all implementation tasks are complete, iterate over each implemented
item that has a draft reply.

For each item:

1. Present the draft reply text (generated in Phase 2, refined in Phase 4)
2. Use `AskUserQuestion`:

   ```text
   Question: "Post this reply for Item [N]?"
   Header: "Reply [N]"
   Options:
     - "Post as-is" (description: Post the draft reply to the PR comment)
     - "Edit then post" (description: Modify the reply text before posting)
     - "Skip" (description: Do not post a reply for this item)
   ```

3. If "Edit then post" is selected, receive the edited text from the user
4. For approved replies, post via GitHub MCP:
   - Inline review comments (type `"inline"`, has `commentId`):
     use `add_reply_to_pull_request_comment` with the original `commentId`
     and `pullNumber`
   - Conversation comments (type `"conversation"` or `"review"`):
     use `add_issue_comment` on the PR number
