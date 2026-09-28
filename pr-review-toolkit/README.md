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

## Usage

Review a PR in one command. `claude --worktree` checks out the PR head into an
isolated worktree, and the trailing slash command runs the review immediately:

```bash
claude --worktree '<pr-url>' --permission-mode auto /pr-review-toolkit:review-pr
```

- `--worktree '<pr-url>'` fetches the PR head (`pull/N/head`) into a detached
  worktree, leaving your current checkout untouched.
- `--permission-mode auto` starts the session in Auto mode so the review's
  read-only and GitHub MCP steps run with fewer prompts (see
  [Permissions](#permissions)). Auto mode needs a supported model and may be
  disabled by your settings or organization; when unavailable it falls back to
  Manual mode. Omit the flag to use your configured default permission mode.

If you review PRs often, wrap this in a shell function or alias that accepts a
PR URL and passes it to the command above.

## Review Flow

The skill requires only that the current directory is a git checkout of the
PR head commit — however it got there: a Claude Code worktree
(`claude --worktree "#123"` fetches `pull/N/head`), `gh pr checkout N`, or
the author's own up-to-date branch.

### Preflight

1. **Resolve the PR.** Cheapest sure route first: branch config
   (`gh pr checkout` writes `refs/pull/N/head` to `branch.<name>.merge` in
   fork checkouts — zero network calls), then a server-side `head` filter
   on `list_pull_requests` for named branches, then SHA search as the
   detached-HEAD last resort. Every candidate is verified against the PR's
   head SHA, so resolution only has to produce the right candidate, not
   prove it. Exactly one open PR must match; zero or several is an honest
   error.
2. **Verify the head.** PR metadata comes from one `pull_request_read`
   call. `git rev-parse HEAD` must equal the PR's head SHA — unpushed local
   commits or a stale checkout after a push produce an honest error naming
   the fix. A dirty working tree warns but does not block (file reads would
   see uncommitted edits; the diff itself is tree-to-tree).
3. **Identify the reviewer.** One `get_me` call records your login so the
   workflow can recognise your own earlier threads and reviews on the PR
   (see [Follow-up reviews](#follow-up-reviews)). If it fails, the run
   proceeds as a first review and says so.
4. **Pin the review range.** After verifying `origin` points at the PR's
   base repository (a fork clone would silently produce a wrong merge-base),
   the skill runs `git fetch origin refs/heads/<base.ref>` — unconditionally,
   so the base is current at review time; this is the toolkit's only network
   git command — and pins `merge_base = git merge-base FETCH_HEAD HEAD`
   (`FETCH_HEAD` is exact regardless of the clone's refspec configuration).
   `git rev-list --count <merge_base>..FETCH_HEAD` measures how far the
   base has moved since the PR forked.

### Workflow

The bundled script is registered as a plugin workflow (the `workflows` entry
in `plugin.json`), so the skill launches it by name —
`pr-review-toolkit:review-pr-analysis` — and Claude Code loads the script
itself from the installed plugin. The launch carries a small `args` payload: the PR
metadata subset, the checkout path, the pinned `merge_base`, and your GitHub
login. No bulk data rides `args` — workflow agents gather their own diff
context from the checkout. The workflow:

- collects existing review threads and submitted reviews through GitHub MCP
  read tools (collector agent) in parallel with a **selector** agent that
  reads the changed-file list over the pinned range (`git diff --shortstat`,
  `--name-status`, `--numstat`, and per-file patches only where needed) and
  returns which lenses should run, a one-line rationale each, and the PR's
  shape
- falls back to running **all** lenses when selector output fails validation
  — selection is disclosed in `reviewMeta.lensSelection`, never silent
- detects a **follow-up review** when threads or reviews by your login exist
  on a PR you did not open, and records the commit you last reviewed
- fans out the selected specialists in parallel; each reads the checkout
  directly — read-only `git diff` over `<merge_base>..HEAD` for patches,
  Read/Grep/Glob for contents, and `git log`/`blame`/`show` only when a
  finding depends on history — so findings carry PR head line numbers by
  construction. In a follow-up review a **verifier** agent joins the fan-out,
  checks each of your earlier asks against the head, and reports what
  changed since your review
- synthesizes a review board: the synthesis agent returns only decisions —
  which findings share a concern, each group's section, and which existing
  thread it overlaps — and the workflow builds the board items from the
  specialists' own text and the collector's thread records

The workflow does not draft or post comments. Drafting happens in the skill
conversation after the user selects findings. Posting requires an exact
preview and explicit final approval.

The control flow is:

```text
skill command (in a PR head checkout)
  |-- resolve PR, verify HEAD == PR head, fetch base, pin merge_base
  v
Workflow(pr-review-toolkit:review-pr-analysis) -> workflow agent() calls
  collector  -> pr-review-github-collector  -> GitHub MCP reads (threads, reviews)
  selector   -> pr-review-selector          -> read-only git over the pinned range
  specialists-> pr-review-analysis-readonly -> read-only repo/git inspection (no MCP)
  verifier   -> pr-review-analysis-readonly -> your earlier asks vs the head (follow-up only)
  synthesis  -> pr-review-synthesis         -> no tools; prompt JSON only
```

Name-mode invocation exists for compatibility with Claude Code's Workflow
hardening: since 2.1.251, a `scriptPath` outside the session's readable set
(working directory, added directories) is rejected by design — "scriptPath
must be a script path this tool returned, or a file you can already read" —
and the plugin cache is outside that set. Registering the script as a named
plugin workflow lets the CLI load it as trusted plugin content instead. On
older Claude Code versions without plugin workflows, the skill falls back to
launching the same file via `scriptPath`, which those versions accept. The
workflow's registered name is deliberately distinct from the skill's: named
workflows surface as slash commands under `<plugin>:<workflow-name>`, and a
workflow named `review-pr` would shadow the skill's
`/pr-review-toolkit:review-pr` entry, dispatching bare workflow invocations
without the skill's setup steps.

### Merge signals

The board reports mergeability from metadata instead of analyzing GitHub's
synthetic merge ref: "merge conflicts with base" (or "mergeability still
computing" while GitHub's `mergeable` is null), and "base has moved N
commits since this PR forked" when the base advanced. A merge-conflicted PR
still reviews fine — integration breakage is CI's job. See
`docs/DESIGN_NOTES.md` for the head-anchoring rationale.

### Follow-up reviews

When the collector finds review threads or a submitted review authored by
your login (`reviewerLogin`, from `get_me`), the run becomes a follow-up
review, unless you opened the PR: on your own PR your threads and comments
are author notes, so follow-up mode stays off. The board gains a
"Follow-up review" section: the commit you last reviewed, how far the PR
has moved since, and one verdict per thread you opened and per ask from
your review summaries that still stands — addressed, partial, not
addressed, or unverifiable — with concrete evidence from the head checkout
and the commit that addressed it when the reviewed commit is still
reachable. The verifier reuses the read-only specialist agent type and runs
only in this mode.

Follow-up mode also changes what gets recommended. The verifier returns the
hunks changed since the commit you reviewed, and after synthesis the
workflow tags each finding with whether its location falls in them
(`changedSinceLastReview`). Routing then demotes non-critical findings on
unchanged code into Other findings with the note "code unchanged since your
review" (`routingNote`), instead of re-recommending code you already looked
at. Specialists are unaware of follow-up mode and review the full PR.
Nothing is dropped: the board shows the demotion reason, and `promote F<n>`
brings a finding back. If the reviewed commit is not in the head's history
(usually a rewritten branch), the tag is omitted and no demotion happens.

## Review Agents

| Agent | When it runs | What it does |
|-------|-------------|--------------|
| code-reviewer | Always | Reviews code for bugs, style, and guideline adherence |
| silent-failure-hunter | Changes touch error handling, try/catch, retries, or fallback logic | Identifies silent failures and inadequate error handling |
| pr-test-analyzer | Functional code changed that should have corresponding tests | Analyzes test coverage completeness |
| comment-analyzer | Changes touch docs files, or add or modify comments or docstrings | Checks comment accuracy and maintainability |
| type-design-analyzer | Changes introduce or modify type definitions in typed languages | Evaluates type design and invariant quality |
| security-reviewer | Changes touch auth, crypto, tokens, credentials, input handling at trust boundaries, or other security-sensitive code | Reviews for security vulnerabilities and unsafe patterns |
| api-compat-reviewer | Changes touch public APIs, exports, schemas, or client-facing interfaces | Checks API compatibility and breaking changes |
| concurrency-reviewer | Changes touch mutexes, locks, channels, goroutines, async, or parallel code | Reviews concurrency patterns for races and deadlocks |

The selector agent picks lenses from the real diff with a liberal posture:
when in doubt, the lens runs, and general correctness (code-reviewer) always
runs. Specialists inherit the session model — no hardcoded model pins for
review lenses (they become silent downgrades as models advance); effort is
the only dial. The two mechanical stages are pinned on purpose: the thread
collector runs on Haiku and the lens selector on Sonnet. All specialists
execute in parallel within a single workflow. The follow-up verifier is not
a lens: it runs on the specialist agent type, in the same fan-out, only when
a follow-up review was detected.

## Review Board

The workflow returns a review board grouped by outcome:

- `recommendedToPost` — high-signal findings that look postable by a human
  reviewer, judged on merit whether or not they overlap an existing thread
- `discussionOnly` — useful reviewer notes that should not be posted yet,
  including findings the workflow demoted with a `routingNote`
- `alreadyCovered` — findings fully covered by existing human or bot review
  threads
- `discarded` — weak, low-confidence, or non-actionable findings (duplicates
  across lenses are merged into one finding instead)

Overlap with an existing thread is an annotation on the finding
(`existingReviewOverlap`: status, thread and comment ids, resolution state,
the thread's author and location, rationale), not a section. It decides how
a selected finding is posted — as a reply on that thread — not whether it is
recommended. A finding that overlaps one of your own earlier threads carries
`followUpItemId` pointing at the matching follow-up verdict.

Recommended and Other findings carry the specialist's own title, claim,
evidence, why it matters, suggested fix, severity, confidence, and lens;
findings merged from several lenses carry a merged title and claim and the
distinct evidence of each. Already-covered and discarded findings carry only
their title, claim, and routing reason. The board also includes positive
observations, the PR shape (`summary`), `followUp` (null on a first
review; otherwise the reviewed commit, its state and date, the commit count
since, verdicts with ids `P1..Pn`, and whether the delta was available), and
review metadata:
`reviewMeta.selectedReviewers` and `reviewMeta.lensSelection` record which
lenses were selected, why, and whether the all-lenses fallback engaged;
`reviewMeta.reviewerLogin` records the login used for follow-up detection
and `reviewMeta.reviewerIsAuthor` that follow-up mode was skipped because
you opened the PR.
Thread resolution and outdated state (`isResolved`, `isOutdated`) are
recorded only when the GitHub read tools expose them. If review-thread
collection fails, the board says so (`reviewMeta.threadCollectionFailed`)
instead of silently skipping overlap classification and verdicts on your
earlier threads; a failed read of submitted reviews is disclosed separately
(`reviewMeta.reviewsCollectionFailed`), since asks made only in a review
summary then go unchecked.
If synthesis fails, every finding is listed on its own, routed by severity
and confidence, and the board says duplicates were not merged and overlap
was not checked (`reviewMeta.synthesisFailed`).
A lens that fails outright is named in `reviewMeta.failedReviewers`, so
reduced coverage is disclosed rather than hidden behind the full reviewer
list; a failed verifier lists your threads as unverifiable and says your
review-summary asks were not checked (`followUp.verifierFailed`).

## Interaction And Posting

After the board is presented, the skill offers options that depend on the
board state: draft the recommended findings (overlapping ones as thread
replies), also reply on your still-open follow-ups, adjust the selection,
approve because your previous findings were addressed, leave an approving
review, or cancel. Free-form replies are accepted and loop back to updated
options: asking about a finding id, `promote F<n>` / `demote F<n>`, or
"too picky", which demotes every non-critical recommended finding not tagged
as changed since your last review (on a first review, every non-critical
one).

Drafts are plain conversation text until the user approves a preview. The skill
previews each line comment, thread reply, review-body text, and the proposed
review event (`COMMENT`, `REQUEST_CHANGES`, `APPROVE`, or none for a run of
replies only) before any GitHub write tool is used.

Board layout and menu rules load from the bundled `references/board.md` when
the workflow returns, and drafting, preview, and posting mechanics from
`references/posting.md` when the flow reaches them, keeping each set of
instructions fresh in context at the moment it applies and the skill file
itself within its context budget.

Findings anchor to PR head line numbers from birth — no line translation
step exists. A finding whose line is not part of the PR diff (validated
against `git diff -U0` hunks before preview) goes into the review body.
Before posting, the skill re-fetches metadata once and aborts
honestly if the head SHA changed since analysis (the review would no longer
describe the PR). The pending review pins the reviewed head SHA as
`commitID` so comment anchors stay attached to the reviewed commit.

## Permissions

The target is auto permission mode; the skill's pre-approved patterns still
run prompt-free under stricter modes, where specialist/selector Bash is the
one surface that may prompt.

### Local Git Commands

Deterministic preflight identity — head SHA, checkout root, branch, origin
URL, branch config, dirty status — is injected by skill preprocessing
(`` !`command` `` substitution), not model-issued Bash. The skill's
`allowed-tools` frontmatter permits the read-only git commands the flow
itself runs — `git rev-parse`, `git merge-base`, `git rev-list`,
`git --literal-pathspecs diff` (line-anchor validity) — plus `git fetch origin` for the single
base-branch fetch, and also pre-approves the injected preflight commands'
patterns (`git status`, `git config --get-regexp`,
`git remote get-url origin`, `cut`) as deliberate belt and braces. The
skill never builds a checkout and never touches the
working tree or index; the base-branch fetch is the only command that
writes anything (objects and the remote-tracking ref).

### Workflow Agents

Skill `allowed-tools` constrains only the orchestrator — workflow-spawned
agents get their tool surface from their own bundled agent definitions. The
session's permission mode is what enforces the read-only boundary on agent
Bash: in auto mode every subagent action goes through the classifier with the
parent session's rules, Manual mode prompts, and `dontAsk` denies. The
instruction-level git contracts below are defense in depth on top of that,
not the enforcement layer.

- **pr-review-github-collector** — allowlist: `pull_request_read` only. No
  shell, no local files, no web, so large MCP responses never lead to
  generated Python, `jq`, `gh`, or other ad-hoc parsing scripts.
- **pr-review-selector** — `Bash`, `Read`, `Grep`, with an
  instruction-level read-only git contract: `diff`/`log`/`show` over the
  pinned range only, `--literal-pathspecs` and a literal `--` before paths.
- **pr-review-analysis-readonly** (specialists) — allowlist: `Bash`,
  `Read`, `Grep`, `Glob`. Bash is allowed under the same instruction-level
  read-only git contract. No MCP tools, so no GitHub writes and no MCP
  schema overhead on every turn (see
  [DESIGN_NOTES](docs/DESIGN_NOTES.md#specialists-allowlist-no-mcp)).
- **pr-review-synthesis** — no tools at all. It works from prompt JSON, and
  it is the agent fed the most untrusted text (finding bodies, thread
  comments) — exactly the agent that should hold no capabilities.

### GitHub MCP Permissions

The plugin depends on the [github](../github) plugin.

Analysis requires these read capabilities:

- `search_pull_requests` / `list_pull_requests` to resolve the checkout's PR
- `get_me` to learn your login for follow-up detection (review-pr only)
- `pull_request_read` with `get`
- `pull_request_read` with `get_review_comments` and `get_reviews`
- `pull_request_read` with `get_comments` (address-pr-feedback only)

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
- the same concern flagged by two lenses (one merged finding, both lenses
  named)
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
- a PR you reviewed before, with threads that were addressed, partially
  addressed, and ignored (follow-up section with one verdict each; findings
  on unchanged code demoted with a routing note; an overlapping finding
  tagged and previewed as a reply on your thread)
- a PR you reviewed before whose branch was force-pushed since (delta
  unavailable: verdicts from current code only, no demotion)
- a PR you never reviewed (no follow-up section, no demotion notes)
- `get_me` unavailable (warning, first-review board)

For each run, verify that PR metadata and review-thread context come from MCP
tools, findings carry PR head line numbers, lens selection is disclosed in
`reviewMeta.lensSelection`, no generated parsing scripts are used, existing
review context affects recommendations, the review board is understandable,
the drafts remain editable, and posting requires explicit approval.

## Prerequisites

- [github](../github) plugin (provides MCP tools for PR operations)
- a local git checkout of the PR head (`claude --worktree '<pr-url>'` or
  `gh pr checkout N`)
