---
name: triage-prs
description: >-
  Triage open pull requests that need the user's attention — PRs where they are
  assigned or a requested reviewer. Investigates each PR in parallel,
  auto-clears notifications for closed or bot-blocked PRs, then presents
  batched triage options to unassign, remove review requests, or unsubscribe.
disable-model-invocation: true
argument-hint: '[owner/repo]'
allowed-tools:
  - Bash(gh api */pulls/*/requested_reviewers -X DELETE *)
  - mcp__plugin_github_github__get_me
  - mcp__plugin_github_github__search_pull_requests
  - mcp__plugin_github_github__pull_request_read
  - mcp__plugin_github_github__add_issue_comment
  - mcp__plugin_github_github__issue_write
  - mcp__plugin_github_github__list_notifications
  - mcp__plugin_github_github__dismiss_notification
  - mcp__plugin_github_github__manage_notification_subscription
  - AskUserQuestion
  - Agent
---

# Triage PRs

Investigate open PRs that need your attention in the target repo, then present batched triage with options to unassign or unsubscribe.

## Repo Context

- Repo argument (overrides remote detection if non-empty): $ARGUMENTS
- Detected remote: !`git remote get-url upstream 2>/dev/null || git remote get-url origin 2>/dev/null || echo __NO_REMOTE__`

## Phase 1: Setup

**Determine repo identity:**
If the repo argument above is non-empty, parse it as `OWNER/REPO`. Otherwise parse `OWNER` and `REPO` from the detected remote URL — support both SSH (`git@github.com:OWNER/REPO.git`) and HTTPS (`https://github.com/OWNER/REPO`) forms. The `upstream` remote is preferred over `origin` so fork-based workflows triage the upstream repo, not the fork. If the remote is `__NO_REMOTE__` and no argument was given, print "No GitHub remote detected — re-run as `/github:triage-prs owner/repo`." and stop.

**Get authenticated user:**
Call `mcp__plugin_github_github__get_me` → store login as `USERNAME`. Needed for identifying your reviews, Prow commands, and non-Prow API actions.

## Phase 2: Collect PRs

Run two searches in parallel using `@me` syntax:

```text
search_pull_requests(query: "assignee:@me is:open", owner, repo)
search_pull_requests(query: "review-requested:@me is:open", owner, repo)
```

Deduplicate by PR number. Tag each PR with its roles: `assigned`, `reviewer`, or both. Paginate using `perPage: 100` if results are truncated.

If no PRs found: print "No open PRs found where you are assigned or a requested reviewer in OWNER/REPO." and stop.

**Detect Prow:** call `pull_request_read(method: "get_status")` on the first collected PR. Set `HAS_PROW = true` if any status context name contains `"tide"`, else `false`.

## Phase 3: Parallel Investigation

Dispatch one Agent per PR using `model: "sonnet"`, in parallel batches of at most 10 PRs at a time. Each agent prompt must be self-contained — pass `owner`, `repo`, `pr_number`, and `username` explicitly.

Each agent performs these MCP calls:

1. `pull_request_read(method: "get")` — title, author, draft status, labels, timestamps
2. `pull_request_read(method: "get_check_runs")` **and** `pull_request_read(method: "get_status")` — merge both sources (Prow and other external CI report via commit status contexts, not check runs); aggregate to: X/Y passing, Z failing [names], W pending
3. `pull_request_read(method: "get_reviews")` — record the date of your most recent review (any state); for your effective decision use your latest `APPROVED` or `CHANGES_REQUESTED` review, since a later `COMMENTED` review does not supersede it; note all other reviewers and their states; record whether USERNAME appears at all (any state) as `reviewed_before`
4. `pull_request_read(method: "get_files")` — file count, key filenames, total additions/deletions
5. `pull_request_read(method: "get_commits", perPage: 100)` — filter to commits dated after LAST_REVIEW_DATE; summarize via commit messages. Skip if not yet reviewed.
6. `pull_request_read(method: "get_review_comments")` — count your unresolved vs resolved review threads
7. `pull_request_read(method: "get_comments", perPage: 100)` — paginate through all issue comments (not just recent); note mentions or questions directed at you, and record whether USERNAME appears among comment authors as `commented_before`

Every list method above is paginated: request `perPage: 100` and traverse every page (cursor pagination via `after` for `get_review_comments`) before summarizing, so late pages can't hide your latest review, open threads, or new commits.

If the PR is merged or closed: return `"Merged/Closed"` and stop (this still counts as investigated — Phase 4 auto-dismisses it).

**Return this exact format:**

```text
PR #NUMBER: TITLE
Author: AUTHOR | Created: DATE | Updated: DATE | Draft: yes/no
Role: [assigned] [reviewer]
Labels: LABEL1, LABEL2
State: open/closed/merged

CI: X/Y passing, Z failing [CHECK_NAMES], W pending → green/red/yellow/pending
My Last Review: STATE on DATE  (or: Not yet reviewed)
Previously Engaged: yes/no  (reviewed_before OR commented_before)
Changes Since Review: N new commits — SUMMARY  (or: None / N/A)
My Open Threads: N unresolved of M total
Other Reviews: REVIEWER (STATE), ...
Files: N files (+ADDS/-DELS) — KEY_FILENAMES
Recent Activity: SUMMARY

Recommended Action: ACTION_CATEGORY
```

**Action categories** (pick highest-priority that applies):

- **Author addressed feedback** — you requested changes; author pushed new commits and/or resolved threads
- **Review needed** — not yet reviewed by you
- **Re-review needed** — new commits since your last review (you hadn't requested changes)
- **CI failing** — CI is red
- **Ready to merge** — approved, CI green, no blockers
- **Waiting on author** — you requested changes, no new commits
- **Waiting on CI** — CI still running
- **Stale** — no activity in >7 days

## Phase 4: Auto-Classification

Before presenting anything to the user, run each investigated PR through these rules **in order**. The first matching rule wins; stop evaluating further rules for that PR once one matches.

1. **Closed or merged** → `dismiss`
2. **Previously Engaged** (`reviewed_before` or `commented_before` is yes) → `keep` (you're already invested in this PR — leave its notification alone and skip triage entirely; don't ask about it, don't touch it)
3. **`HAS_PROW` is true, and `needs-rebase` label present** → `dismiss`
4. **`HAS_PROW` is true, and both `lgtm` and `approved` labels are present** (from anyone other than you — Previously Engaged already excluded you above) → `unsubscribe`
5. **Otherwise** → `manual`

Execute the auto-classified actions now, per PR:

- **`dismiss`**: from the notification list (call `list_notifications(owner, repo, filter: "include_read_notifications")` once for this phase — read notifications are excluded by default — paginating through all pages, and reuse it across PRs), find the thread(s) whose `subject.url` matches this PR, `dismiss_notification(threadID, state: "done")`. Do **not** call `manage_notification_subscription`.
- **`unsubscribe`**: same lookup, then both `dismiss_notification(threadID, state: "done")` **and** `manage_notification_subscription(notificationID, action: "ignore")`.
- **`keep`**: no action at all — don't dismiss, don't touch the subscription, don't ask about it in Phase 5. The notification stays exactly as it is.
- **`manual`**: no action yet — these carry forward into Phase 5.

> **Dismiss vs. unsubscribe:** `dismiss_notification(state: "done")` clears only the current notification thread — new PR activity creates a fresh notification later, which is what `dismiss` cases (closed, needs-rebase) want. Only `manage_notification_subscription(action: "ignore")` stops future notifications, so it is reserved for `unsubscribe` cases.

Report auto-classified PRs in a short summary line before moving to Phase 5, e.g.: "Auto-dismissed 3 (2 closed, 1 needs-rebase). Auto-unsubscribed 1 (lgtm+approved). Kept 2 for review (already engaged)."

## Phase 5: Triage

Sort all `manual`-classified agent results by urgency (order matches the category list above).

Present in batches of up to 4 using `AskUserQuestion` (tool supports 1–4 questions per call, 2–4 options each). Each question is one PR.

**Question:** `PR #NUMBER: TITLE (by @AUTHOR) — RECOMMENDED_ACTION`

**Description:** CI state, last review date, changes since review, other reviewer states

**Options** (adapt by role):

| Role | Options |
|------|---------|
| `assigned` only | Skip / Unassign me |
| `reviewer` only | Skip / Remove review request |
| both | Skip / Unassign me / Remove review request / Unsubscribe (both) |

After each batch, continue to the next batch if more PRs remain.

## Phase 6: Execute Actions

For each PR where the user chose an unassign/unsubscribe action in Phase 5, execute all sub-steps in parallel across PRs.

### Remove assignment / review request

**If `HAS_PROW`:** post a GitHub comment with Prow bot commands:

- Unassign: `add_issue_comment(owner, repo, issue_number: PR, body: "/unassign")`
- Remove review: `add_issue_comment(owner, repo, issue_number: PR, body: "/uncc")`
- Both: single comment with `/unassign` and `/uncc` on separate lines

**If not `HAS_PROW`:**

- Unassign: `issue_write(method: "update", owner, repo, issue_number: PR, assignees: [all current assignees except USERNAME])`
- Remove review: `gh api repos/OWNER/REPO/pulls/PR/requested_reviewers -X DELETE -f 'reviewers[]=USERNAME'` (no GitHub MCP tool can remove a review request). If `gh` is unavailable or unauthenticated, skip this call, note in the final summary that the review request must be removed manually, and continue with the remaining actions.
- Both: execute both

### Clear GitHub notifications

Call `list_notifications(owner, repo, filter: "include_read_notifications")` once, paginating through all pages, and reuse the results across PRs. For each notification matching this PR:

1. `dismiss_notification(threadID, state: "done")`
2. `manage_notification_subscription(notificationID, action: "ignore")` — **only if the chosen action removed every role you held on the PR** (unassign when you were only assigned, remove review request when you were only a reviewer, or both removals when you held both roles) **and every removal step actually executed** (e.g. don't ignore when the `gh` call was skipped as unavailable). If a role remains or a removal was skipped, dismiss only, so future activity still notifies you.

### Summary

Report all actions taken, combining Phase 4's auto-classification with this phase's user-driven actions: "Auto-dismissed 3 (2 closed, 1 needs-rebase). Auto-unsubscribed 1 (lgtm+approved). Kept 2 for review (already engaged). Unassigned from PR #X. Removed review request on PR #Y. Cleared N notifications."
