---
name: triage-prs
description: >-
  Triage open pull requests that need the user's attention — PRs where they are
  assigned or a requested reviewer. Auto-classifies and clears notifications for
  PRs that need no attention, investigates the rest in parallel, then presents
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

**Repo identity:** if the repo argument above is non-empty, parse it as `OWNER/REPO`. Otherwise parse the detected remote URL — SSH (`git@github.com:OWNER/REPO.git`) or HTTPS (`https://github.com/OWNER/REPO`). If it is `__NO_REMOTE__` and no argument was given, print "No GitHub remote detected — re-run as `/github:triage-prs owner/repo`." and stop.

**Authenticated user:** call `mcp__plugin_github_github__get_me` → store login as `USERNAME`.

## Phase 2: Collect and Classify

Run four searches in parallel (paginate with `perPage: 100` if truncated):

```text
search_pull_requests(query: "assignee:@me is:open", owner, repo)          # role: assigned
search_pull_requests(query: "review-requested:@me is:open", owner, repo)  # role: reviewer
search_pull_requests(query: "commenter:@me is:open", owner, repo)         # engagement
search_pull_requests(query: "reviewed-by:@me is:open", owner, repo)       # engagement
```

Candidates are the union of the first two searches, deduplicated by PR number and tagged with roles `assigned`, `reviewer`, or both. A candidate is **engaged** if its number appears in either engagement search.

If no candidates: print "No open PRs found where you are assigned or a requested reviewer in OWNER/REPO." and stop.

**Detect Prow:** call `pull_request_read(method: "get_status")` on the first candidate. `HAS_PROW = true` if any status context name contains `"tide"`.

**Classify** each candidate from its search-result data (state, labels, engagement) — first matching rule wins:

1. **Closed or merged** → `dismiss`
2. **Engaged** → `keep` (already invested — leave its notification alone and exclude it from all later phases)
3. **`HAS_PROW` and `needs-rebase` label** → `dismiss`
4. **`HAS_PROW` and both `lgtm` and `approved` labels** → `unsubscribe`
5. **Otherwise** → `manual`

**Notification lookup** (used here and in Phase 5): call `list_notifications(owner, repo, filter: "include_read_notifications")` once per phase — read notifications are excluded by default — paginate all pages, and match threads whose `subject.url` points at the PR.

Execute the classifications now:

- **`dismiss`**: `dismiss_notification(threadID, state: "done")` on matching threads. Do **not** touch the subscription.
- **`unsubscribe`**: `dismiss_notification(threadID, state: "done")` **and** `manage_notification_subscription(notificationID, action: "ignore")`.
- **`keep`** / **`manual`**: no action; `manual` PRs continue to Phase 3.

> **Dismiss vs. unsubscribe:** `dismiss` clears only the current notification thread — new PR activity notifies again, which is what `dismiss` cases (closed, needs-rebase) want. Only `ignore` stops future notifications, so it is reserved for `unsubscribe`.

Report a summary line, e.g.: "Auto-dismissed 3 (2 closed, 1 needs-rebase). Auto-unsubscribed 1 (lgtm+approved). Kept 2 (already engaged). Investigating 4."

## Phase 3: Parallel Investigation

For `manual` PRs only, dispatch one Agent per PR using `model: "sonnet"`, in parallel batches of at most 10. Each agent prompt must be self-contained — pass `owner`, `repo`, `pr_number`, and `username` explicitly.

Each agent performs these `pull_request_read` calls:

1. `get` — title, author, draft status, labels, timestamps
2. `get_check_runs` **and** `get_status` — merge both (external CI such as Prow reports via status contexts); aggregate to: X/Y passing, Z failing [names], W pending
3. `get_reviews` — date of your most recent review (any state); for your effective decision use your latest `APPROVED` or `CHANGES_REQUESTED` review, since a later `COMMENTED` review does not supersede it; note all other reviewers and their states
4. `get_files(perPage: 100)` — first page only; file count ("100+" if truncated), key filenames, additions/deletions
5. `get_commits(perPage: 100)` — commits dated after your last review; summarize via commit messages. Skip if not yet reviewed.
6. `get_review_comments` — count your unresolved vs resolved review threads
7. `get_comments(perPage: 100)` — most recent page only; note mentions or questions directed at you

Paginate `get_reviews`, `get_commits`, and `get_review_comments` fully (`perPage: 100`; cursor via `after` for `get_review_comments`). Steps 4 and 7 deliberately read a single page.

If the PR is merged or closed: return `"Merged/Closed"` — run the `dismiss` action for it.

**Return this exact format:**

```text
PR #NUMBER: TITLE
Author: AUTHOR | Created: DATE | Updated: DATE | Draft: yes/no
Role: [assigned] [reviewer]
Labels: LABEL1, LABEL2

CI: X/Y passing, Z failing [CHECK_NAMES], W pending → green/red/yellow/pending
My Last Review: STATE on DATE  (or: Not yet reviewed)
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

## Phase 4: Triage

Sort the agent results by urgency (order matches the category list above). Present in batches of up to 4 using `AskUserQuestion`, one question per PR, until all are covered.

**Question:** `PR #NUMBER: TITLE (by @AUTHOR) — RECOMMENDED_ACTION`

**Description:** CI state, last review date, changes since review, other reviewer states

**Options** (adapt by role):

| Role | Options |
|------|---------|
| `assigned` only | Skip / Unassign me |
| `reviewer` only | Skip / Remove review request |
| both | Skip / Unassign me / Remove review request / Unsubscribe (both) |

## Phase 5: Execute Actions

For each PR where the user chose an action, execute all sub-steps in parallel across PRs.

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

Using the Notification lookup from Phase 2 (fresh call for this phase), for each thread matching the PR:

1. `dismiss_notification(threadID, state: "done")`
2. `manage_notification_subscription(notificationID, action: "ignore")` — **only if the chosen action removed every role you held on the PR** (unassign when you were only assigned, remove review request when you were only a reviewer, or both removals when you held both roles) **and every removal step actually executed** (e.g. don't ignore when the `gh` call was skipped as unavailable). If a role remains or a removal was skipped, dismiss only, so future activity still notifies you.

### Summary

Combine Phase 2's auto-classification summary with this phase's actions, e.g.: "Auto-dismissed 3 (2 closed, 1 needs-rebase). Auto-unsubscribed 1 (lgtm+approved). Kept 2 (already engaged). Unassigned from PR #X. Removed review request on PR #Y. Cleared N notifications."
