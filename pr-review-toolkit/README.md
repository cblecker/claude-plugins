# PR Review Toolkit

Reimplementation of Anthropic's
[pr-review-toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit)
as a single Workflow-based skill. The workflow selects review lenses from the
real diff, runs specialist reviewers against a local checkout of the PR head,
and returns an interactive review board for the human reviewer.

## Skills

### review-pr

```text
/pr-review-toolkit:review-pr
```

Conduct a comprehensive PR review and return an interactive review board.
The skill takes no arguments: check out the PR first (e.g.
`claude --worktree '<pr-url>'` or `gh pr checkout N`), then run
`/pr-review-toolkit:review-pr` from that checkout. See
[Review Flow](#review-flow) below.

### address-pr-feedback

```text
/pr-review-toolkit:address-pr-feedback [--interactive]
```

Systematically collect, analyze, score, and address pull request review
feedback from the current branch's PR. After implementing changes, drafts
reply comments and posts them to GitHub with per-reply user approval.

By default, the skill auto-detects the open PR for the current branch and
fetches all review comments via GitHub MCP. Use `--interactive` to manually
paste feedback items instead.

**Flow:** branch validation &rarr; feedback collection &rarr; parallel
analysis and scoring (Sonnet + Haiku agents) &rarr; per-item action
confirmation &rarr; plan generation &rarr; implementation &rarr; reply
posting.

## Review Flow

The skill requires only that the current directory is a git checkout of the
PR head commit — however it got there: a Claude Code worktree
(`claude --worktree "#123"` fetches `pull/N/head`), `gh pr checkout N`, or
the author's own up-to-date branch.

### Preflight

1. **Resolve the PR.** The local HEAD SHA and the `origin` owner/repo
   identify the PR via GitHub MCP search (`search_pull_requests`, with
   `list_pull_requests` as fallback for search-index lag). Exactly one open
   PR must match; zero or several is an honest error.
2. **Verify the head.** PR metadata comes from one `pull_request_read`
   call. `git rev-parse HEAD` must equal the PR's head SHA — unpushed local
   commits or a stale checkout after a push produce an honest error naming
   the fix. A dirty working tree warns but does not block (file reads would
   see uncommitted edits; the diff itself is tree-to-tree).
3. **Pin the review range.** After verifying `origin` points at the PR's
   base repository (a fork clone would silently produce a wrong merge-base),
   the skill runs `git fetch origin <base.ref>` — unconditionally, so the
   base is current at review time; this is the toolkit's only network git
   command — and pins `merge_base = git merge-base origin/<base.ref> HEAD`.
   `git rev-list --count <merge_base>..origin/<base.ref>` measures how far
   the base has moved since the PR forked.

### Workflow

The skill launches the bundled workflow with a small `args` payload: the PR
metadata subset, the checkout path, and the pinned `merge_base`. No bulk data
rides `args` — workflow agents gather their own diff context from the
checkout. The workflow:

- collects existing review threads through GitHub MCP read tools (collector
  agent) in parallel with a **selector** agent that runs the diff itself
  (`git diff --name-status` / `--numstat` and the hardened diff over the
  pinned range) and returns which lenses should run, a one-line rationale
  each, and the PR's shape
- falls back to running **all** lenses when selector output fails validation
  — selection is disclosed in `reviewMeta.lensSelection`, never silent
- fans out the selected specialists in parallel; each reads the checkout
  directly — Read/Grep/Glob for contents, read-only
  `git log`/`blame`/`show`/`diff` over `<merge_base>..HEAD` for history and
  patches — so findings carry PR head line numbers by construction
- synthesizes findings into a review board grouped by posting
  recommendation, existing-review overlap, and discussion value

The workflow does not draft or post comments. Drafting happens in the skill
conversation after the user selects findings. Posting requires an exact
preview and explicit final approval.

The control flow is:

```text
skill command (in a PR head checkout)
  |-- resolve PR, verify HEAD == PR head, fetch base, pin merge_base
  v
Workflow(review-pr.js) -> workflow agent() calls
  collector  -> pr-review-github-collector  -> GitHub MCP reads (threads)
  selector   -> pr-review-selector          -> read-only git over the pinned range
  specialists-> pr-review-analysis-readonly -> read-only repo/git/MCP inspection
  synthesis  -> pr-review-synthesis         -> no tools; prompt JSON only
```

### Merge signals

The board reports mergeability from metadata instead of analyzing GitHub's
synthetic merge ref: "merge conflicts with base" (or "mergeability still
computing" while GitHub's `mergeable` is null), and "base has moved N
commits since this PR forked" when the base advanced. A merge-conflicted PR
still reviews fine — integration breakage is CI's job. See
`docs/DESIGN_NOTES.md` for the head-anchoring rationale.

## Review Agents

| Agent | When it runs | What it does |
|-------|-------------|--------------|
| code-reviewer | Always | Reviews code for bugs, style, and guideline adherence |
| silent-failure-hunter | Changes touch error handling, try/catch, or fallback logic | Identifies silent failures and inadequate error handling |
| pr-test-analyzer | Functional code that should have corresponding tests | Analyzes test coverage completeness |
| comment-analyzer | Changes touch docs files, comments, or docstrings | Checks comment accuracy and maintainability |
| type-design-analyzer | Changes introduce or modify type definitions in typed languages | Evaluates type design and invariant quality |
| security-reviewer | Changes touch auth, crypto, tokens, credentials, or security-related code | Reviews for security vulnerabilities and unsafe patterns |
| api-compat-reviewer | Changes touch public APIs, exports, or client-facing interfaces | Checks API compatibility and breaking changes |
| concurrency-reviewer | Changes touch mutexes, locks, channels, goroutines, or parallel code | Reviews concurrency patterns for races and deadlocks |

The selector agent picks lenses from the real diff with a liberal posture:
when in doubt, the lens runs, and general correctness (code-reviewer) always
runs. Specialist model is inherited from the session — no hardcoded model
pins (they become silent downgrades as models advance); effort is the only
dial. All specialists execute in parallel within a single workflow.

## Review Board

The workflow returns a review board grouped by outcome:

- `recommendedToPost` — high-signal findings that look postable by a human
  reviewer and are not already covered
- `relatedToExisting` — findings that overlap or endorse existing review threads
- `discussionOnly` — useful reviewer notes that should not be posted yet
- `alreadyCovered` — findings fully covered by existing human or bot review
  threads
- `discarded` — weak, duplicate, low-confidence, or non-actionable findings

Each finding preserves the specialist's claim, evidence, reasoning, suggested
fix, confidence, source lens, and existing-review overlap rationale. The board
also includes positive observations, PR metadata, and review metadata:
`reviewMeta.selectedReviewers` and `reviewMeta.lensSelection` record which
lenses ran, why, and whether the all-lenses fallback engaged. Thread
resolution state (`isResolved`) is recorded only when the GitHub read tools
expose it. If review-thread collection fails, the board says so
(`reviewMeta.threadCollectionFailed`) instead of silently skipping overlap
classification.

## Interaction And Posting

After the board is presented, the user can ask to draft recommended findings,
draft specific finding ids, add a plus-one, skip findings, challenge findings,
show already-covered findings, or cancel.

Drafts are plain conversation text until the user approves a preview. The skill
previews each line comment, review-body text, and the proposed review event
(`COMMENT`, `REQUEST_CHANGES`, or `APPROVE`) before any GitHub write tool is
used.

Findings anchor to PR head line numbers from birth — no line translation
step exists. A finding whose line is not part of the PR diff goes into the
review body. Before posting, the skill re-fetches metadata once and aborts
honestly if the head SHA changed since analysis (the review would no longer
describe the PR). The pending review pins the reviewed head SHA as
`commitID` so comment anchors stay attached to the reviewed commit.

## Permissions

The target is auto permission mode; the skill's pre-approved patterns still
run prompt-free under stricter modes, where specialist/selector Bash is the
one surface that may prompt.

### Local Git Commands

The skill's `allowed-tools` frontmatter permits only the read-only git
commands the flow actually runs — `git rev-parse`, `git status`,
`git remote get-url origin`, `git merge-base`, `git rev-list` — plus
`git fetch origin` for the single base-branch fetch. The skill never builds
a checkout and never mutates the repository.

### Workflow Agents

Skill `allowed-tools` constrains only the orchestrator — workflow-spawned
agents get their tool surface from their own bundled agent definitions:

- **pr-review-github-collector** — allowlist: `pull_request_read` only. No
  shell, no local files, no web, so large MCP responses never lead to
  generated Python, `jq`, `gh`, or other ad-hoc parsing scripts.
- **pr-review-selector** — `Bash`, `Read`, `Grep`, with an
  instruction-level read-only git contract: `diff`/`log`/`show` over the
  pinned range only, literal `--` before paths.
- **pr-review-analysis-readonly** (specialists) — a denylist agent so
  read-only MCP tools (language servers such as gopls) stay usable. Bash is
  allowed under the same instruction-level read-only git contract; every
  GitHub write tool in the github plugin's toolsets is hard-denied
  (re-audited when the dependency updates), as are file mutation tools,
  `Task`, and web tools.
- **pr-review-synthesis** — no tools at all. It works from prompt JSON, and
  it is the agent fed the most untrusted text (finding bodies, thread
  comments) — exactly the agent that should hold no capabilities.

### GitHub MCP Permissions

The plugin depends on the [github](../github) plugin.

Analysis requires these read capabilities:

- `search_pull_requests` / `list_pull_requests` to resolve the checkout's PR
- `pull_request_read` with `get`
- `pull_request_read` with `get_review_comments`

Approved posting, if the user chooses to post, requires these write
capabilities:

- `pull_request_review_write` to create and submit a review
- `add_comment_to_pending_review` to add approved line comments to a pending
  review
- `add_reply_to_pull_request_comment` to post approved endorsements as
  replies on existing review threads
- `add_issue_comment` (address-pr-feedback only) to reply to review-body and
  conversation comments

Write tools are used only after the skill has shown the exact preview and the
user has explicitly approved posting it.

## Validation

Basic plugin validation:

```bash
claude plugin validate ./pr-review-toolkit
npx markdownlint-cli2 --config ${CLAUDE_PROJECT_DIR}/.markdownlint-cli2.jsonc "pr-review-toolkit/**/*.md"
```

Representative PR validation should cover:

- small PRs with and without existing review comments
- PRs where existing human or bot comments fully cover a candidate finding
- partial-overlap and plus-one cases
- discussion-only findings
- large PRs with hundreds of files (complete review with no API pagination;
  selector reports true scale)
- large PRs dominated by vendor, generated, or lockfile changes
- missing-test, error-handling, comment/doc, and type/model/interface changes
- PRs with meaningful positive observations
- a merge-conflicted PR (must review fine, with the conflict surfaced as a
  board signal)
- a stale checkout or unpushed local commits (honest error naming the fix)
- a detached-HEAD worktree checkout (PR resolution still works)
- a dirty working tree (warns, proceeds)
- a selector returning invalid output (all-lenses fallback engages, disclosed
  in `reviewMeta.lensSelection`)
- PRs with renames, copies, deletes, binary files, and paths with special
  characters

For each run, verify that PR metadata and review-thread context come from MCP
tools, findings carry PR head line numbers, lens selection is disclosed in
`reviewMeta.lensSelection`, no generated parsing scripts are used, existing
review context affects recommendations, the review board is understandable,
the drafts remain editable, and posting requires explicit approval.

## Prerequisites

- [github](../github) plugin (provides MCP tools for PR operations)
- a local git checkout of the PR head (`claude --worktree '<pr-url>'` or
  `gh pr checkout N`)
