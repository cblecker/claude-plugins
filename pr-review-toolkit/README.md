# PR Review Toolkit

Reimplementation of Anthropic's
[pr-review-toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit)
with separate Claude and Codex implementations. Both select specialist lenses
from the real diff, review a local PR head checkout, and build an interactive
board for discussion and approved feedback. Claude uses a bundled Workflow;
Codex uses native subagents. See [Codex usage](#codex-usage) for the native port.
The sections through Prerequisites below describe the Claude implementation.

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
3. **Pin the review range.** After verifying `origin` points at the PR's
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
Workflow(pr-review-toolkit:review-pr-analysis) -> workflow agent() calls
  collector  -> pr-review-github-collector  -> GitHub MCP reads (threads)
  selector   -> pr-review-selector          -> read-only git over the pinned range
  specialists-> pr-review-analysis-readonly -> read-only repo/git/MCP inspection
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
execute in parallel within a single workflow.

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

After the board is presented, the skill offers options that depend on the
board state: draft the recommended findings, draft everything including
overlap endorsements, adjust the selection, endorse overlap findings, leave
an approving review, or cancel. Free-form replies (asking about a specific
finding id, adding a plus-one to an existing thread, challenging a finding)
are accepted and loop back to updated options.

Drafts are plain conversation text until the user approves a preview. The skill
previews each line comment, review-body text, and the proposed review event
(`COMMENT`, `REQUEST_CHANGES`, or `APPROVE`) before any GitHub write tool is
used.

Drafting, preview, and posting mechanics load just-in-time from the
bundled `references/posting.md` when the flow reaches them, keeping the
instructions fresh in context at the moment they apply.

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
- **pr-review-analysis-readonly** (specialists) — a denylist agent so
  read-only MCP tools (language servers such as gopls) stay usable. Bash is
  allowed under the same instruction-level read-only git contract; every
  GitHub write tool in the github plugin's toolsets is hard-denied
  (re-audited when the dependency updates), as are file mutation tools,
  the `Agent` tool (and its `Task` alias), and web tools.
- **pr-review-synthesis** — no tools at all. It works from prompt JSON, and
  it is the agent fed the most untrusted text (finding bodies, thread
  comments) — exactly the agent that should hold no capabilities.

### GitHub MCP Permissions

The plugin depends on the [github](../github) plugin.

Analysis requires these read capabilities:

- `search_pull_requests` / `list_pull_requests` to resolve the checkout's PR
- `pull_request_read` with `get`
- `pull_request_read` with `get_review_comments`
- `pull_request_read` with `get_reviews` and `get_comments`
  (address-pr-feedback only)

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

## Codex Usage

Install the plugin from this repository's marketplace using Codex's plugin UI or
CLI. The existing marketplace entry supports both clients; the Codex manifest
selects `./codex/skills/`, so Claude's workflow and `address-pr-feedback` skill are
not loaded by Codex.

Prerequisites: Node.js, Git, authenticated `gh`, Git HTTPS authentication for
private repositories, and Codex CLI 0.154.0 or later with native worktree support,
native subagents, and GitHub MCP read tools.
Approved posting also needs the GitHub review and reply write tools. The Claude
`github` plugin dependency does not configure GitHub MCP for Codex automatically.
Use your normal Codex MCP configuration.

Source the launcher **after** defining your authenticated `gh` and `codex` aliases, using the
absolute path to this checkout or the installed plugin. Source it from **bash**, as the
`.bash` extension signals: it locates the plugin through `BASH_SOURCE`. From zsh or another
shell, source it inside a bash session or export `CODEX_REVIEW_PLUGIN_ROOT` with the absolute
path to the plugin directory first.

```bash
source /absolute/path/to/pr-review-toolkit/codex/bin/codex-review-pr.bash
codex-review-pr https://github.com/OWNER/REPO/pull/123
```

Run it from a clone of the PR's base repository or a fork with that upstream
parent. Preparation verifies the relationship, fetches over HTTPS, and returns
compact version-2 JSON containing the canonical source checkout, common Git
directory, source HEAD, PR identity, and pinned head/base/merge-base. It leaves
source files, index, HEAD, refs, and worktree registrations intact. Concurrent
fetches do not write shared `FETCH_HEAD` or refs.

The launcher invokes `codex --enable worktrees --worktree --cd <source>` with
`$review-pr` and the JSON in one quoted prompt argument. Native worktree support
is required and enabled per invocation; unsupported CLIs report their own error.
`CODEX_REVIEW_PLUGIN_ROOT` can override the plugin location. Codex creates and
owns the worktree. The skill rechecks the PR pins through MCP, then a guarded
helper selects the PR head only in a clean, detached linked worktree sharing the
source repository. The source checkout may be dirty and at a different commit.
Repository guidance is read after checkout, before specialist analysis.

The actual review checkout and pins stay in the conversation alongside the board
and drafts. Use `codex --enable worktrees resume <SESSION_ID>` to continue a
retained review; resume revalidates the checkout and range without switching HEAD.
Native CLI worktrees provide creation and ownership tracking. Automatic CLI
cleanup is currently disabled in CLI 0.154.0, so retained worktrees need explicit
cleanup when finished. The toolkit preserves Codex's exit status and promises no
deletion on exit, including failed starts. Older
toolkit-created worktrees receive no automatic migration or deletion; inspect
`git worktree list` and remove those individually when finished.

Preparation obtains its GitHub token through the shell's `gh auth token` command,
so authentication aliases such as a 1Password wrapper are honored. The token is
passed to preparation as `GH_TOKEN`; it is not saved or exported to the parent
shell. Codex continues to use its own alias and normal authentication settings.

You can also invoke `$review-pr <PR_URL>` in a clean checkout already at the PR
head. The skill verifies the repository and PR and pins the base before analysis;
this route does not switch the checkout.

### Native review flow

The parent collects the PR shape and selects lenses while a native collector
reads existing GitHub review threads. Independent specialist subagents examine
the pinned range in separate contexts, using the session's model and reasoning
settings. Available agent capacity controls parallelism; additional lenses wait
for a slot. General correctness always runs, and relevant lenses are included
liberally with their selection disclosed.

The parent checks candidate evidence, relevant callers, and counterexamples,
follows up on uncertainty, and assesses evidence and impact separately from lens
scores. It merges duplicate concerns and compares against human and bot threads.
The compact board uses readable labels: Recommended to post, Related to existing
discussion, Discuss first, Already covered, and Discarded. Concerns, locations,
impact, and thread relationships lead; supporting evidence follows. Finding IDs
remain stable through discussion and reclassification, with merges explained.
The board, drafts, and posting progress live in the conversation. Failed reviewers,
unread material, truncated results, and incomplete thread collection remain visible
as coverage limitations. There is no subprocess-worker fallback.

Selected feedback is drafted in your voice. At final preview, the skill refreshes
discussion and reconsiders overlap, preserving selections and IDs while showing
changed recommendations, text, or targets. Failed refreshes mean unknown coverage.
It verifies inline locations and reply targets and presents the exact text and
review event for approval. Selection or board approval never authorizes posting;
changed text or targets require a revised preview and approval. It checks the PR
head before every write and reconciles partial failures against GitHub before retrying.

### Codex permissions

Codex uses your normal session sandbox, approvals, credentials, and project
configuration. Review-only behavior and the collector/specialist division are
instructions, not enforced per-stage tool restrictions. The launcher does not
install a permission profile, configure worker credentials, or disable project settings.

Specialists remain inspection-only. The parent may run focused existing tests or
temporary reproductions to resolve concrete uncertainty, using normal permissions
and allowing ordinary cache or temporary artifacts. Repository source stays
unchanged; unexpected checkout changes are reported, artifacts are not removed
automatically, and clean-checkout and resume safeguards still apply.

### Local Codex installation and validation

From the repository root:

```bash
node pr-review-toolkit/codex/bin/validate.mjs
node --test pr-review-toolkit/codex/test/*.test.mjs
node pr-review-toolkit/codex/bin/validate.mjs --install
```

The install check uses a temporary Codex home, installs from this local
marketplace, checks bundled files and exclusive skill discovery, and removes the
temporary installation. It does not change your normal Codex installation.

Tests exercise real local Git repositories, fork/upstream preparation, unusual
paths, dirty source checkouts, concurrent fetches, moving PR heads/bases, missing
ancestry, and preservation of source state. Checkout tests cover guarded PR-head
selection, repeat invocation, verification on resume, and refusals that preserve
existing work. Launcher tests verify native flags, exact inline context, shell
aliases, token scoping, preparation failures, and Codex exit status. GitHub
metadata is mocked and HTTPS fetches are redirected to fixture remotes.

For a real CLI smoke test, use a disposable repository with a dirty source at a
different commit from the pinned PR head. Launch with native worktrees, pass the
context to the checkout helper, record the checkout and pins, then exit and
resume the session. Verify that the source files, index, HEAD, and refs remain
intact and that the retained checkout and conversation still have the same pins.

Behavioral validation should exercise small and large PRs, existing human/bot
threads, failed reviewers, unavailable subagents, incomplete collection, editable
drafts, changed heads, invalid anchors, and partial posting failures. Use
simulated GitHub responses for posting tests; live writes still require exact
preview approval. Static checks and launcher tests cannot establish review
quality; native review behavior needs evaluation in a Codex session.

#### Recorded refinement validation (2026-09-15)

**Helper and static checks:** all 50 Node helper/launcher tests passed; temporary
installation and exclusive Codex skill discovery passed. Markdown lint, strict
skillsaw (CLI 0.20.0, repository rule pin 0.19.0), skill-creator validation,
Claude plugin manifest validation, and `git diff --check` passed. These checks
establish packaging and helper behavior, not review quality.

**Behavioral exercise inputs:** a temporary Git repository contained two changed
files (32 additions, 4 deletions) and explicit project rules for persistence,
handler-owned logging, optional theme fallback, booking order, timeout units,
plain transport records, and retry-exhaustion tests. Baseline instructions came
from `070b03a`; revised instructions came from this working-tree refinement.
Two fresh native agent contexts inherited the same session model and effort,
with no overrides. Exact runtime model/effort identifiers were not exposed by
this evaluation interface. Each agent inspected the same five relevant lenses
in one context, then received identical simulated GitHub responses separately.
This exercises staged review decisions, not full independent-lens orchestration.

| Fixture input | Decision being exercised |
|---|---|
| `saveOrder` rethrows to a logging HTTP handler; `saveBatch` catches `insertMany` rejection and returns `[]`, while its handler returns 201 | Owning-handler propagation versus a swallowed required write |
| `optionalTheme` returns an explicitly permitted default on cache failure | Intended fallback versus the required-write contract |
| Plain `searchTerm` record permits empty text; removed `booking` guard admits request-derived end <= start | Appropriate simplicity versus a reachable invariant regression |
| Timeout export documented as milliseconds but consumed as seconds; new retry test covers immediate success only | Consequential documentation and test findings |
| Human thread 101 covers batch failure; bot thread 102 covers booking; duplicate E1 adds the same batch caller trace; T1 only cites a mutable-record pattern | Merge evidence, classify overlap, and reject unsupported design advice |
| Collection page 2 times out and a selected API reviewer fails before reading | Disclose partial coverage |
| Final refresh adds human thread 103 covering timeout units; alternate refresh times out | Reconsider overlap and preserve unknown coverage |
| Unrelated pending review 900; edited approved reply; head moves after reply 501; ambiguous create/reply; rejected target; unexpected pending content | Approval, head checks, ownership, and reconciliation |

**Observed decisions:** both contexts found the swallowed batch failure, removed
booking guard, misleading timeout unit, and explicit retry-exhaustion test gap.
Both accepted the optional fallback and plain search record, traced the rethrow
to handler-owned logging without recommending duplicate logs, merged E1 into F1,
and discarded T1's unsupported encapsulation advice. Documentation and test
findings survived without being described as current runtime failures.

Both preserved finding IDs and disclosed incomplete collection and the failed
reviewer. Both requested current threads before using refreshed responses: the
baseline did so to fill its incomplete collection; the revised instructions
required it at final preview. Both detected thread 103's overlap and kept failed
refresh coverage unknown. Both paused submission for unrelated pending review
900, required revised approval for edited drafts/targets and unexpected staged
content, stopped after head movement while retaining successful reply 501, and
avoided retries when readback confirmed reply 502. Unreconciled creation stopped;
a thread node ID was not accepted as a numeric reply target. No live writes ran.

For a requested focused check, the baseline context declined execution under its
blanket inspection restriction. The revised context ran an inline Node
reproduction in the parent role: rejected `insertMany` yielded status 201 with
zero handler logs, and reversed/equal request endpoints yielded durations -5/0.
Assertions passed and status was clean before and after; no source was edited.
This verifies those fake-database and request-input paths, not a real service.

The initial finding decisions were the same on this small fixture; this single
paired run does not demonstrate improved review quality or statistically reliable
behavior. Full independent specialists, large changes, a dedicated empty-result
case, real MCP pagination, and real posting remain outside this behavioral run.

The disposable inputs, pinned commits, instruction snapshots, agent reports, and
simulated discussion cases were temporary local evidence and were not committed
to the repository.

**Real native CLI smoke:** a new disposable repository had staged, unstaged, and
untracked source changes at a commit different from the pinned head. Actual CLI
0.154.0 was invoked with `--enable worktrees exec --worktree --json -C <source>`.
Normal-home startup and its escalated retry failed to create the managed worktree
root. With a disposable `CODEX_HOME`, normal model settings (`gpt-6-astra`,
`medium`) and permission rules were preserved; credentials were not copied and
no sandbox bypass was used. These are smoke-test settings, not plugin defaults.

The real CLI created two detached native worktrees at the source HEAD. Both
remained after startup failed with `sandbox-exec: sandbox_apply: Operation not
permitted`, including the escalated retry. The real checkout helper, run
externally in each worktree, selected the pinned PR head and passed `--verify`.
Source file bytes, index, HEAD, branch, refs, and status matched the pre-launch
snapshot. No worktree was deleted. Detailed commands, context, and results were
recorded in temporary local artifacts and were not committed to the repository.

Session initialization, ownership binding, retention after a successful session,
and real resume remain **blocked**: no session thread was created. External
helper verification does not establish native resume. This smoke used the actual
installed CLI; stubbed launcher tests remain a separate check.
