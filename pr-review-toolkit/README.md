# PR Review Toolkit

Reimplementation of Anthropic's
[pr-review-toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit)
as a Claude Code workflow plus a Claude Code mod. Every step outside the lens
fan-out runs in the mod: preflight, review-thread collection, lens selection
and synthesis (model calls the mod makes itself), the review board, and
posting, with an interactive review pane to drive them. A bundled workflow fans
out one read-only specialist reviewer per selected lens against a local
checkout of the PR head, and each reports its findings straight back to the
mod.

## Requirements

- **Claude Code 2.1.287 or later.** The review pane is a Claude Code mod, and
  no plugin manifest field can state a minimum version, so it is stated here
  and in the skill.
- **Personal machines only.** Managed setups block the mod: managed settings
  that set `allowedMcpServers` refuse its tool registration (`prepare_review`,
  the deposit tools, `set_drafts`), and `allowManagedModsOnly` refuses the
  whole mod. There is no fallback for surfaces that cannot draw a pane.
- The [github](../github) plugin, which provides the GitHub MCP tools the mod
  calls.
- A local git checkout of the PR head (`claude --worktree '<pr-url>'` or
  `gh pr checkout N`).

## Skills

### review-pr

```text
/pr-review-toolkit:review-pr
```

Conduct a comprehensive PR review and open an interactive review pane. The
skill takes no arguments: check out the PR first (e.g.
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

## Commands

### /review-board

Opens the review pane, or focuses it when it is already open. The pane opens
by itself when a review is prepared and again when its board is ready, but an
unasked open never takes the keyboard (see [The review pane](#the-review-pane)),
so `/review-board` is how you start using it. On a terminal too narrow to draw
the pane, the toast that says so points here too.

## Usage

Review a PR in one command. `claude --worktree` checks out the PR head into an
isolated worktree, and the trailing slash command runs the review immediately:

```bash
claude --worktree '<pr-url>' --permission-mode auto /pr-review-toolkit:review-pr
```

- `--worktree '<pr-url>'` fetches the PR head (`pull/N/head`) into a detached
  worktree, leaving your current checkout untouched.
- `--permission-mode auto` starts the session in Auto mode so any tool call the
  specialists make beyond read-only git runs with fewer prompts (see
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

```text
/pr-review-toolkit:review-pr   (run in a PR head checkout)
  |
  |-- Claude calls prepare_review
  |     mod: resolve the PR, verify HEAD, fetch and pin the base, collect threads,
  |          detect a follow-up, select lenses; opens the pane (progress)
  |-- Claude calls Workflow(pr-review-toolkit:review-pr-analysis, { pr: handle })
  |     launch hook: injects the full args
  |     workflow:    one pr-review-analysis-readonly agent per lens (+ the follow-up verifier)
  |                  each reports with submit_findings / submit_followup
  |-- Claude stops
  v
mod: completion notice rewritten to one line -> synthesis -> board
pane: board -> Draft -> Claude drafts with set_drafts -> preview -> Post -> GitHub writes
```

Claude makes two tool calls and stops. Everything after that happens in the
pane, driven by you.

### Prepare

`prepare_review` is a tool the mod registers; it runs as code, so no git or
GitHub step depends on the model:

1. **Resolve the PR.** Cheapest sure route first: branch config
   (`gh pr checkout` writes `refs/pull/N/head` to `branch.<name>.merge` in
   fork checkouts — zero network calls), then a server-side `head` filter
   on `list_pull_requests` for named branches, then a scan of open PRs for
   the head SHA as the detached-HEAD last resort. Exactly one open PR must
   match; zero or several is an honest error.
2. **Verify the head.** PR metadata comes from one `pull_request_read`
   call. `git rev-parse HEAD` must equal the PR's head SHA — unpushed local
   commits or a stale checkout after a push produce an honest error naming
   the fix. The PR must be open, and `origin` must point at the PR's base
   repository (a fork clone would silently produce a wrong merge-base). A
   dirty working tree warns but does not block (file reads would see
   uncommitted edits; the diff itself is tree-to-tree).
3. **Identify the reviewer.** One `get_me` call records your login so the
   run can recognise your own earlier threads and reviews on the PR (see
   [Follow-up reviews](#follow-up-reviews)). If it fails, the run proceeds as
   a first review and says so.
4. **Pin the review range.** `git fetch origin refs/heads/<base.ref>` runs
   unconditionally, so the base is current at review time; this is the
   toolkit's only network git command. Then
   `merge_base = git merge-base FETCH_HEAD HEAD` (`FETCH_HEAD` is exact
   regardless of the clone's refspec configuration),
   `git rev-list --count HEAD..FETCH_HEAD` measures how far the base has
   moved since the PR forked, and `git diff` over `<merge_base>..HEAD` gives
   the file list and churn.
5. **Collect review data.** Review threads (`get_review_comments`) and, on a
   PR you did not open, your submitted reviews (`get_reviews`), paginated to
   the end. Follow-up detection and the delta since your last review are
   computed here, with git, not by an agent.
6. **Select lenses.** One Sonnet call reads the changed-file list and
   per-file churn and returns which lenses should run, a one-line rationale
   each, and the PR's notable areas. Any failure runs every lens instead,
   and the pane says so.

The tool answers with a handle (`owner/repo#N`) or an error, which the skill
reports verbatim. It also opens the pane in its progress view without taking
the keyboard. Only one run exists at a time: preparing again while a run is in
progress or posting is refused until you cancel it or it finishes.

### Workflow

The bundled script is registered as a plugin workflow (the `workflows` entry
in `plugin.json`), so the skill launches it by name —
`pr-review-toolkit:review-pr-analysis` — and Claude Code loads the script
itself from the installed plugin. A mod cannot start a workflow, so Claude does,
and the mod's launch hook rewrites the call's `args`: the PR metadata subset,
the checkout path, the pinned `merge_base`, the lens list with each lens's
effort, the follow-up context, and a run nonce. The hook launches only from a
fresh preparation and denies, with the reason, when the preparation was already
used, a run is in flight, `HEAD` moved since it was prepared, or you cancelled
it; it also denies a call that names a `script`, `scriptPath` or
`resumeFromRunId` beside the workflow name. No bulk data rides `args`: agents gather their own diff context from the
checkout. The workflow:

- fans out the selected specialists in parallel; each reads the checkout
  directly — read-only `git diff` over `<merge_base>..HEAD` for patches,
  Read/Grep/Glob for contents, and `git log`/`blame`/`show` only when a
  finding depends on history — so findings carry PR head line numbers by
  construction
- in a follow-up review adds a **verifier** agent to the fan-out, which checks
  each of your earlier asks against the head given the delta the mod computed
  (it judges; it runs no ancestry checks)
- has each agent report by calling a mod tool (`submit_findings` or
  `submit_followup`) with the run nonce. The mod validates the submission and
  answers `accepted`, or `rejected` with what to fix, and the agent corrects
  and calls again. A lens with no accepted submission counts as failed and is
  named on the board
- returns only whether each agent reported; results never travel through the
  workflow

When the workflow ends, the mod rewrites its completion notice to a single
line (`Review complete — the board is opening in the review pane
(/review-board).`, `Review failed: <status> — see the review pane.`, or, for a
run you cancelled, `Review cancelled — see the review pane (/review-board).`),
so no workflow result or warning reaches the transcript. Synthesis then runs detached
(one Sonnet call at medium effort, two attempts) and the pane reopens, without
taking the keyboard, when the board is ready.

The skill never launches the script by path: a `scriptPath` launch carries no
workflow name, so the launch hook would not match it and the args would never
be injected; a call that names both is denied, since `scriptPath` would win
over the name and take the injected args to another script. The workflow's registered name is deliberately distinct from the
skill's: named workflows surface as slash commands under
`<plugin>:<workflow-name>`, and a workflow named `review-pr` would shadow the
skill's `/pr-review-toolkit:review-pr` entry, dispatching bare workflow
invocations without the skill's setup.

### The review pane

The pane (`PR review`) draws one view per phase of the run:

| Phase | What the pane shows | What you can do |
|-------|---------------------|-----------------|
| progress | The lenses running, a follow-up note, warnings; "Synthesizing…" once the lenses are done | Cancel review |
| board | The review board (see [Review Board](#review-board)) | Select, promote/demote, Too picky, ask Claude, Draft, Approve without comments, Cancel review |
| drafting | "Claude is drafting…" | Back to board, Back to preview (when rewording), Cancel review |
| preview | The exact review that will post | Choose the review event, Reword, Post this review, Edit (back to the board), Cancel review |
| posting | "Posting to owner/repo#N…" and the tally | Nothing; posting cannot be taken back |
| done / failed | What posted, or why the review failed or was cancelled | Run `/pr-review-toolkit:review-pr` again |

Every button can be clicked. The single-letter shortcuts shown on some buttons
(`d`, `t`, `e`, `b`, `v`, `c`, `r`) work only while the pane holds the keyboard:
`/review-board` gives it the keyboard, and Esc hands it back to the prompt. A
pane that opens by itself never takes the keyboard, so typing meant for the
prompt cannot press a button. Anything that posts or approves, and Cancel
review, has no shortcut key: click it, or Tab to it and press Enter. Text in
the pane comes from the PR and the lenses, so a link in it is never opened.

### Merge signals

The board reports mergeability from metadata instead of analyzing GitHub's
synthetic merge ref: "merge conflicts with base" (or "mergeability still
computing" while GitHub's `mergeable_state` is `unknown`), and "base has moved N
commits since this PR forked" when the base advanced. A merge-conflicted PR
still reviews fine — integration breakage is CI's job. See
`docs/DESIGN_NOTES.md` for the head-anchoring rationale.

### Follow-up reviews

When `prepare_review` finds review threads or a submitted review authored by
your login (from `get_me`), the run becomes a follow-up review, unless you
opened the PR: on your own PR your threads and comments are author notes, so
follow-up mode stays off and the pane says so. The board gains a "Follow-up"
section: the commit you last reviewed, how far the PR has moved since, and one
verdict per thread you opened and per ask from your review summaries that
still stands — addressed, partial, not addressed, or unverifiable — with
concrete evidence from the head checkout and the commit that addressed it when
the reviewed commit is still reachable. Each verdict has an id (`P1`..`Pn`),
can be selected for a reply, and can be asked about. The verifier reuses the
read-only specialist agent type and runs only in this mode.

Follow-up mode also changes what gets recommended. The mod computes the hunks
changed since the commit you reviewed, and after synthesis tags each finding
with whether its location falls in them. Routing then demotes non-critical
findings on unchanged code into Other findings with the note "Code unchanged
since your review at `<sha>`", instead of re-recommending code you already
looked at. Specialists are unaware of follow-up mode and review the full PR.
Nothing is dropped: the board shows the demotion reason, and promoting a
finding brings it back. If the reviewed commit is not in the head's history
(usually a rewritten branch), no finding is tagged and no demotion happens.

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

Lens selection is a liberal Sonnet call over the changed-file list and churn:
when in doubt, the lens runs, and general correctness (code-reviewer) always
runs. The mod keeps a small roster of lens names, conditions, and efforts for
this, and the workflow fails fast on a lens name it does not know. Specialists
inherit the session model — no hardcoded model pins for review lenses (they
become silent downgrades as models advance); effort is the only dial, set per
lens (`high`, except comment-analyzer at `medium`). The two mechanical model
steps the mod runs, lens selection and synthesis, are pinned on purpose to
Sonnet at medium effort. All specialists execute in parallel within a single
workflow. The follow-up verifier is not a lens: it runs on the specialist agent
type, in the same fan-out, at medium effort, only when a follow-up review was
detected.

## Review Board

The board groups findings by outcome:

- **Recommended to post** — high-signal findings that look postable by a human
  reviewer, judged on merit whether or not they overlap an existing thread.
  They start selected; each shows its severity, confidence, and lens, and its
  claim, evidence, why it matters, and suggested fix (when the specialist
  supplies one) inline
- **Other findings** — useful reviewer notes that should not be posted yet,
  including findings demoted with a routing note; each is one line with its
  reason
- **Not posting** — findings fully covered by existing human or bot review
  threads, and weak, low-confidence, or non-actionable ones (duplicates across
  lenses are merged into one finding instead), each with its reason

A finding merged from several lenses carries a merged title and claim and the
distinct evidence of each. The board also lists positive observations and the
PR's shape (file count, additions and deletions from git, scale, notable
areas). Findings are numbered `F1`..`Fn` once, after routing; every later
action keys on those ids.

Overlap with an existing thread is an annotation on the finding (a tag such as
`↳ overlaps @alice thread on path:line (unresolved) → posts as a reply`), not a
section. It decides how a selected finding is posted — as a reply on that
thread — not whether it is recommended. A finding that overlaps one of your own
earlier threads is tagged as following up the matching `P` item.

Board actions:

- **Select** a recommended finding or a follow-up item with its `[x]` box. Items
  already posted show "posted" instead.
- **promote / demote** moves a finding between Recommended and Other findings;
  a promoted finding joins the selection, and a demoted one leaves it. Items in
  Not posting can be promoted too.
- **Too picky** demotes every non-critical recommended finding not tagged as
  changed since your last review (on a first review, every non-critical one).
- **Ask Claude** about a recommended finding, an Other finding, or a follow-up
  item: the input under it sends your question with the item to Claude, and
  the answer arrives in the conversation. Items in Not posting have no input;
  promote one to ask about it.
- **Draft N selected** asks Claude for comments on the selection.
- **Approve without comments** goes straight to a preview of an approval with
  no comments. It is not offered on your own PR, since GitHub refuses
  approving your own PR, and it warns when it would approve requests nobody
  verified (follow-up items not addressed, or review data that could not be
  read).
- **Cancel review** stops the run.

Every degraded step is disclosed in the pane rather than hidden: a lens
selection that fell back to all lenses, a lens that failed outright (named, so
reduced coverage is visible), review threads or your earlier reviews that could
not be read (and so overlap or verdicts that could not be checked), a failed
synthesis (findings are then listed unmerged, routed by severity and confidence
alone, with overlap unchecked), a failed verifier (your threads are then
unverifiable), and a delta that could not be determined. Thread resolution and
outdated state are shown only when the GitHub read tools expose them.

## Drafting, Preview, And Posting

**Draft.** Draft moves the run to drafting and sends Claude the selected items
as JSON, with the instruction to follow `references/drafting.md` and call the
mod's `set_drafts` tool once, covering every selected id exactly once. The mod
validates the call and answers `accepted`, or `rejected` with exactly what to
fix. Claude only drafts; the review event is chosen in the pane, and nothing
posts from the conversation. A selected finding and the follow-up item on the
same thread get one reply between them. Drafts are plain text until you post.

**Preview.** When the drafts are accepted, the pane shows a preview that is
exactly what will post:

- every line comment with its `path:line`, every thread reply with the thread
  it lands on (a reply on a resolved thread is flagged, since it stays
  collapsed), and the assembled review body
- the review event: Comment (the default), Request changes (suggested when a
  selected item is critical), or Approve; only Comment on your own PR
- a tally of what posts and under which event
- a line comment is checked against the PR diff when the drafts are accepted,
  and one whose line is not part of the diff (or whose diff could not be read)
  moves into the review body, and the preview says so
- items with a thread but no comment to reply to post as a new comment, and the
  preview says so

Reword sends your instruction and the current drafts to Claude, which calls
`set_drafts` again; Edit returns to the board with your selection kept.

**Post.** **Post this review** is the sole approval, and it has no
single-letter shortcut: click it, or Tab to it and press Enter. It posts
exactly the preview you were looking at, and refuses if the preview changed
since the pane drew it. The mod re-reads the PR first and stops if its head
moved since the analysis (the review would no longer describe the PR). It then
posts thread replies, then the review: a pending review pinned to the reviewed
head SHA as `commitID` (so comment anchors stay attached to the reviewed
commit), its line comments, and the submit with your event and the body; or,
with no line comments, one review created with its event and body. A run of
replies alone submits no review, since a Comment or Request changes review
needs text.

Posting is cautious about what it cannot confirm. An error that GitHub
validated and refused leaves nothing posted for that write. A reply, or the
single create of a review with no line comments, that fails any other way (a
timeout, a server error) counts as possibly posted and is never sent again; the
pane says what posted before the stop and tells you to check the PR. The same
holds for a submit that fails when the pending review cannot then be deleted,
since the submit may have gone through. A pending review that fails to create,
a line comment that fails, or a submit that fails while the pending review is
deleted cleanly marks nothing further as posted and returns you to the preview
with the error. A failed line comment or submit deletes the pending review that call
created, and a failed create deletes nothing, since the pending review GitHub
refused over may be yours. After a partial post the posted items leave the
selection, so a reword drafts only what is left. When posting ends, the pane lists what posted and
the transcript carries a log of each write as a dim notice.

**Cancel review** is available while a run is in progress, on the board,
drafting, and previewing; it stops the workflow and ends the run as "Review
cancelled." It is not available while posting. Ending the conversation
(`/clear`, `/resume`, exit) drops the run and stops its workflow. Reloading
plugins mid-run recovers: a review whose board was being built starts building
it again, and one found mid-post ends as "Posting was interrupted; check the
PR." rather than offering to post again.

## Permissions

Launching the review takes two model-issued tool calls, `prepare_review` and
`Workflow`, which the skill's `allowed-tools` pre-approves. Git and GitHub
steps run as code in the mod. The turns the pane starts later (Draft, Reword,
and Ask Claude) are ordinary Claude turns, not covered by the skill's
`allowed-tools`: a drafting or reword turn Reads `references/drafting.md` and
calls `set_drafts`, so, depending on your permission mode, those calls may
prompt.

### Local Git Commands

The mod runs the read-only preflight itself: `git rev-parse`,
`git remote get-url origin`, `git config --get-regexp`, `git status`,
`git merge-base`, `git rev-list`, and `git diff`, plus `git diff` per path to
check comment anchors before a preview. `git fetch origin refs/heads/<base>`
for the single base-branch fetch is the only command that writes anything
(objects and the remote-tracking ref). The toolkit never builds a checkout and
never touches the working tree or index.

### Workflow Agents

Skill `allowed-tools` constrains only the orchestrator — workflow-spawned
agents get their tool surface from their own bundled agent definitions.

- **pr-review-analysis-readonly** (specialists and the follow-up verifier) —
  allowlist: `Bash`, `Read`, `Grep`, `Glob`, plus the mod's two deposit tools
  to report their result. Bash is allowed under an instruction-level read-only
  git contract. No GitHub MCP tools, so no GitHub writes and no MCP schema
  overhead on every turn (see
  [DESIGN_NOTES](docs/DESIGN_NOTES.md#specialists-allowlist-no-mcp)).

The session's permission mode is what enforces the read-only boundary on agent
Bash: in auto mode every subagent action goes through the classifier with the
parent session's rules, Manual mode prompts, and `dontAsk` denies. The
instruction-level git contract is defense in depth on top of that.

**Auto-allowed git for lens agents.** While a review run is in progress, the
mod auto-allows a subagent's Bash call, without a prompt (it cannot tell a lens
agent from any other subagent), when every part of the command is read-only git (`rev-parse`, `diff`, `log`, `show`, `blame`,
`merge-base`, `rev-list`, `status`, optionally with `--literal-pathspecs` or
`-c core.quotePath=false`) or `head`/`tail` with a line count, joined only by
`&&`, `||`, `;`, or `|`. Redirection, expansions, subshells, background jobs,
options that write files or read from outside the checkout, and anything the
parser does not fully understand are left to Claude Code's own decision. The
mod only upgrades what Claude Code would otherwise have asked about by default:
a deny, a call that one of your rules asks about, and a call with extra Bash
options are never changed, and the main conversation's Bash is never touched.

### GitHub MCP Permissions

The mod calls the [github](../github) plugin's MCP server.

Analysis requires these read capabilities:

- `list_pull_requests` to resolve the checkout's PR
- `get_me` to learn your login for follow-up detection (review-pr only)
- `pull_request_read` with `get`
- `pull_request_read` with `get_review_comments` and `get_reviews`
- `pull_request_read` with `get_comments` (address-pr-feedback only)

Posting, which happens only when you press Post this review, requires these
write capabilities:

- `pull_request_review_write` to create, submit, and (after a failure) delete
  a pending review
- `add_comment_to_pending_review` to add line comments to a pending review
- `add_reply_to_pull_request_comment` to post replies on existing review
  threads
- `add_issue_comment` (address-pr-feedback only) to reply to review-body and
  conversation comments

Write tools are used only after the pane has shown the exact preview and you
have pressed Post this review.

## Validation

Basic plugin validation:

```bash
cd pr-review-toolkit && claude plugin test
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
  the pane reports true scale)
- large PRs dominated by vendor, generated, or lockfile changes
- missing-test, error-handling, comment/doc, and type/model/interface changes
- PRs with meaningful positive observations
- a merge-conflicted PR (must review fine, with the conflict surfaced as a
  board signal)
- a stale checkout or unpushed local commits (honest error naming the fix)
- a detached-HEAD worktree checkout (PR resolution still works)
- a dirty working tree (warns, proceeds)
- lens selection returning invalid output (all-lenses fallback engages, and the
  pane says so)
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
- your own PR (follow-up off, Comment is the only review event)
- a selected finding whose line is outside the PR diff (moves into the review
  body, and the preview says so)
- cancelling in each phase, and cancelling while posting (refused)

For each run, verify that PR metadata and review-thread context come from MCP
tools, findings carry PR head line numbers, lens selection is disclosed, no
generated parsing scripts are used, existing review context affects
recommendations, the pane is understandable and shows no transcript warnings,
the drafts remain editable, the preview is exactly what posts, and posting
requires explicit approval.

## Prerequisites

- Claude Code 2.1.287 or later, on a personal machine (see
  [Requirements](#requirements))
- [github](../github) plugin (provides MCP tools for PR operations)
- a local git checkout of the PR head (`claude --worktree '<pr-url>'` or
  `gh pr checkout N`)
