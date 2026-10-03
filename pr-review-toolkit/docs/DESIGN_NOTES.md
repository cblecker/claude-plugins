# Design Notes

Decisions behind the 2.x head-checkout architecture and the 3.0 mod hybrid
built on it, recorded so future changes do not re-litigate them blind.
[README.md](../README.md) describes what the review experience provides; this
file records why it is provided the way it is. Sections written for 2.x say
what the workflow did; [Mod hybrid (3.0.0)](#mod-hybrid-300) says what moved
into the mod.

## Review the head, not the merge ref

GitHub's synthetic `refs/pull/N/merge` ref is lazily computed, absent when the
PR is conflicted, and stale after pushes — verified in practice: stale test
merges had `merge^2 != head`. Reviewing the merge result meant translating
merge-result line numbers to PR head line numbers before posting, and made
conflicted PRs unreviewable. 2.0 reviews the PR head directly: findings anchor
to head line numbers from birth, a merge-conflicted PR reviews fine, and
mergeability is a metadata signal on the board. Integration breakage is CI's
job; base movement is reported honestly
(`git rev-list --count HEAD..FETCH_HEAD`) instead of analyzing GitHub's
synthetic merge tree.

## Checkout as precondition

The skill needs only `HEAD == PR head`. Worktrees
(`claude --worktree "#123"` fetches `pull/N/head`) are one convenient way
to get there; `gh pr checkout` and the author's own branch are others. The
toolkit builds no checkouts itself: model-issued `git worktree add` is
sandbox-denied at `.git/` registration, and 1.x's plumbing checkout script
(read-tree/checkout-index dancing around sandbox-protected paths) was
compensation machinery for reviewing the merge ref — deleted with it.

## MCP's narrowed role

GitHub MCP handles exactly three things: metadata (`pull_request_read`
`get`, plus PR resolution via `list_pull_requests`), review threads (a
collector agent through 2.x; the mod's own paginated reads since 3.0), and
posting (the approved write step). Bulk data — the changed-file
manifest and patches — comes from the checkout via read-only git, so
nothing depends on `MAX_MCP_OUTPUT_TOKENS`, `get_files` pagination, or
recovery retries.

## Always fetch the base

`git fetch origin refs/heads/<base.ref>` runs unconditionally before
pinning `merge_base`, so the base is current at review time; the fully
qualified ref cannot be parsed as an option or a same-named tag, and the
pin and base-movement count compare against `FETCH_HEAD`, which is exact
regardless of the clone's refspec configuration. Origin must be verified against the PR's base
repository first: in a fork clone origin points at the fork, and fetching
the fork's branch of the same name would silently compute a wrong
merge-base.

## Selection: deterministic heuristics → selector agent

1.x selected lenses with deterministic path/content heuristics
(`categorizePath`, `signalsForFile`, `enrichSignalsFromDiff`). 2.0 trades
those for a schema-bound selector agent reading the real diff. The trade is
accepted because selection is disclosed, never silent — which lenses ran
and the selector's per-lens rationale land in `reviewMeta.lensSelection` —
and invalid selector output falls back to running all lenses. The liberal
posture is kept: when in doubt, include; general correctness always runs.
Since 3.0 the selector is a text-only Sonnet call in the mod over the
changed-file list and churn (no per-file patches), with the same fallback and
the same disclosure.

## Agent tool surfaces

Skill `allowed-tools` constrains only the orchestrator (learning recorded
from PR #49) — workflow-spawned agents get their tools from their own agent
definitions. Through 2.x the synthesis agent ran with no
tools at all: it is fed the most untrusted text in the flow (finding
bodies, thread comments), and the agent holding the most untrusted input
should hold the fewest capabilities. Since 3.0 synthesis is a text-only model
call in the mod, so it holds no tools by construction.

## Specialists: allowlist, no MCP

Through 2.2 the specialist agent was a *denylist* agent, so read-only MCP
(gopls and other language servers) stayed usable while the github plugin's
write surface was hard-denied. 2.3 makes it an allowlist of `Bash`, `Read`,
`Grep`, and `Glob` (3.0 adds the mod's two deposit tools), based on transcripts
of real runs:

- Behind a custom `ANTHROPIC_BASE_URL` (e.g. a LiteLLM gateway) Claude Code
  turns MCP tool search off, so every inherited MCP schema is sent on every
  specialist turn — and specialists run the most turns in the flow.
- On two gateway-routed runs (non-Claude models, 29–34 file PRs), gopls
  `go_search` was 17% of specialist tool-result volume, 39% of the files it
  returned were vendored or module-cache paths, and one of 22 findings cited
  a symbol-reference lookup. That is a lower bound on its navigation value (a
  search that led to a Read does not show up), but nothing indicated Grep
  could not have found the same code. `go_package_api` on a generated
  package also caused the context overflows handled under *Oversized tool
  results* in the agent definition.
- The same runs made 73 GitHub MCP read calls although the prompt says not
  to refetch PR data.
- Claude runs without gopls installed produced full-quality boards from
  git, Grep, and Read alone.

The allowlist also makes GitHub writes impossible by construction, so there
is no longer a denylist to re-audit when the github plugin updates. If
reviews visibly miss caller or API-impact issues, bring back
`go_symbol_references` alone, not the whole server.

## Investigation scope

The same transcripts showed specialist cost is turns × a context that grows
every turn: gateway-routed specialists ran 55–130 turns each, one grew to
about a million tokens and died, while Claude specialists finished in 5–24.
Most of the extra turns were git history (`log`/`show`, ~320 calls vs 6)
and whole-file reads of unchanged code. Specialist prompts therefore start
from the diff, read changed files around the hunks, use history only when a
specific finding depends on it, and stop once each finding has evidence.

There is deliberately no numeric tool-call budget: the only calibration
data comes from small PRs, and a flat number would cut coverage on large
ones. If the stopping rules prove insufficient, the next step is a budget
scaled from the changed-file count, or a `maxTurns` backstop —
calibrated on measured runs.

## Synthesis returns decisions, not findings

Through 2.3 the synthesizer re-emitted every finding in full, at high
effort, so each finding's text existed five times: specialist output,
synthesis input, synthesis output, workflow return, and the rendered board.
Its prompt told it to *preserve* specialist evidence, so for a lone finding
the rewrite was a copy; the orchestrator reformats every item when it
renders the board anyway. Because the model also copied thread ids and
`commentId`s back, the workflow carried about 400 lines of defensive JS:
re-merging by token keys, choosing between conflicting overlap records, and
guarding against mismatched thread and comment id pairs.

The synthesizer now returns groups of finding indexes, a section, and an
overlap status with a `threadId`, at medium effort. JS builds each item from
the specialists' own fields, and `commentId`, resolution state, and the
thread descriptors come only from the collected thread record for that id, so a
reply target always describes one real thread. The one place a rewrite adds
value is a merge of several lenses' findings, so only multi-finding groups may
carry a new title and claim. Indexes the synthesizer drops still land on the
board as their own items. Since 3.0 the mod runs this step itself, as a
text-only Sonnet call at medium effort with up to two attempts; the grouping is
validated in code (every finding in exactly one group, valid sections), and the
decisions-not-findings shape is unchanged.

The token-overlap heuristic that used to classify overlap when synthesis
failed was removed with the merge machinery. It served only that rare path,
and a wrong word-overlap match could point a reply at the wrong thread.
Synthesis failure is instead disclosed (`reviewMeta.synthesisFailed`) and
findings are routed on severity and confidence alone. Synthesis is skipped
when there are no findings.

The board keeps only what the pane and drafting read: no PR metadata beyond
the run's own, and already-covered and discarded items without their long text
fields. Specialists return `evidence` as one string and fold their reasoning
into `whyItMatters`, which shrinks every later copy.

## Token efficiency (2.5)

A 2.5 audit looked for text that is multiplied: once per specialist, once per
agent turn, or once per later orchestrator turn. What changed, with 3.0's
effect noted where the mod took a step over:

- **PR body.** The body rides in every specialist's prompt on every turn (and,
  through 2.x, the selector's). HTML comments are left out when the PR is read
  (by the orchestrator through 2.x, by the mod since 3.0), and the workflow's
  `promptBody()` strips them again, drops trailing whitespace and extra blank
  lines (indentation stays: it carries meaning in code samples, YAML, and
  nested lists), and caps the body at 5k chars with a truncation marker. It
  stays inside the JSON context, where escaping keeps untrusted text from
  posing as prompt structure, and `<details>` stays because bot PRs keep
  changelogs there.
- **Other authors' threads.** Synthesis sees threads only to judge overlap.
  Other authors' bodies lose HTML comments, `<details>` blocks collapse to
  their `<summary>` line, and bodies are capped at 1000 chars, with the last
  three replies at 400 chars and a `replyCount`. The reviewer's own threads
  and the collected thread records that reply targets come from are untouched.
  Only closed comments and blocks are removed, here and in the PR body: an
  unclosed `<!--` or `<details>` is usually the tag named in inline code, and
  stripping to the end of the text would delete everything after it. Fully
  Markdown-aware stripping was rejected: bot `<details>` blocks contain code
  fences, so skipping fenced code would leave those blocks uncollapsed.
- **One confidence scale.** Routing compares confidence across lenses, but
  only code-reviewer had a rubric (plus its own ≥ 80 filter). A shared 0–100
  rubric now sits in the standard output instructions and code-reviewer's own
  was removed. Findings below 50 are written in one line per field (title,
  claim, evidence, why it matters): `compactItem` drops their long text
  anyway. Higher findings are not capped, because the main session answers
  follow-up questions from exactly those fields and would otherwise re-read
  the code.
- **Optional text.** `suggestedFix` is optional, matching the "when one
  applies" instruction instead of inviting filler. Lenses return at most two
  positive observations, and synthesis keeps them by index
  (`keepPositives`) instead of re-typing them, following the decisions-not-
  findings precedent.
- **Per-lens effort.** comment-analyzer runs at `medium`: its checks are
  local (does this comment match the code beside it). The rest stay at
  `high`; `reviewMeta.lensEffort` records what ran.
- **Verifier delta.** Hunks are `[start, end]` pairs, and the delta diff
  uses `--inter-hunk-context=5` so git merges nearby hunks instead of the
  model transcribing each. A finding in a merged gap reads as changed, which
  errs toward keeping it recommended.
- **Fewer orchestrator turns.** Through 2.x, `get_me` and the board
  instructions' read rode along with the first GitHub call, and fetch,
  merge-base, and the base-ahead count ran as one chained Bash call
  (`HEAD..FETCH_HEAD` counts the same commits as `<merge_base>..FETCH_HEAD`
  and removes the dependency). Since 3.0 the whole preflight is code in the
  mod, so the orchestrator makes two tool calls in all; the mod keeps the
  `HEAD..FETCH_HEAD` count, passes `fields: ["number", "head"]` to PR
  resolution lists, and reads only `merge` keys from branch config.
- **Warnings in JS.** `reviewMeta.warnings` carries finished sentences for
  every degraded step, so the board cannot skip one; the flags stay for the
  menus that branch on them.

Considered and rejected:

- Trimming the upstream-derived lens prompts: unmeasured quality risk.
- Capping evidence, why-it-matters, and fix text on postable findings: they
  are what follow-up questions and drafting read.
- Having the selector hand specialists the manifest or focus paths: one slip
  drops a file from every lens at once.
- Running the narrow lenses together in one agent: breaks per-lens effort,
  failure attribution, and lens-attributed findings.
- Reordering prompts for prefix caching: the shared context and the lens
  text sit in one content block, so there is nothing to gain.
- Pinning synthesis or the verifier to a smaller model, lowering selector
  effort, or skipping synthesis for a lone finding: each saves little and
  degrades the steps that gate what is posted.
- Collector `perPage: 100`: bot-heavy threads would overflow the MCP result
  and fail collection for the whole run. Revisited in 3.0: the mod reads
  pages in code at `perPage: 100`, and a page that fails or a thread cut short
  keeps what was read and says so (a warning) instead of failing the review.
- Dropping sub-50 findings at the source: contradicts disclosure and invites
  confidence inflation.
- Showing only changed entries on re-preview: weakens the exact-preview
  approval guarantee.

On the posting side, the line-anchor check runs one diff per distinct path,
batched in one turn, and a return to the check step reuses output already in
the conversation. Drafting straight into the preview needed no change: the
2.x posting instructions' restructure already showed drafts only once, in the
preview. A lighter head re-check before posting (a filtered PR list instead of
`get`) was rejected: it saves little and adds a fallback path to the most
safety-sensitive step. (3.0 kept the exact-preview guarantee and made it
structural: see [Mod hybrid (3.0.0)](#mod-hybrid-300).)

## Invocation: named plugin workflow, not `scriptPath`

The workflow script is registered in `plugin.json` under `workflows`, so the
skill launches it by name (`pr-review-toolkit:review-pr-analysis`) and Claude
Code loads the file as trusted plugin content. Claude Code 2.1.251 hardened
the Workflow tool to reject a `scriptPath` outside the session's readable set
(working directory and added directories), and the plugin cache is outside
that set; name-mode invocation is the supported path. Through 2.x the skill
kept a `scriptPath` fallback for versions that predate plugin workflows. 3.0
dropped it: a `scriptPath` launch carries no workflow `name`, so the mod's
launch hook (which matches on the name and injects the args) would never see
it, and the workflow would start without its run.

The workflow's `meta.name` is deliberately not `review-pr`: named workflows
surface as slash commands under `<plugin>:<workflow-name>`, and a workflow
named `review-pr` would shadow the skill's `/pr-review-toolkit:review-pr`
entry, dispatching bare workflow invocations without the skill's preflight
(PR resolution, head verification, base fetch, pinned merge-base; since 3.0,
`prepare_review`, without which the launch hook denies the launch).

## Follow-up mode

2.4 recognises a PR the user has reviewed before. Each choice below was the
lighter of the alternatives considered.

**Detection by login, not by argument.** The preflight calls `get_me` once
(the skill did through 2.x; the mod's `prepare_review` does since 3.0) and
the login is matched against thread authors and submitted
reviews (`get_reviews` exposes `commit_id`, `state`, `user.login`,
`submitted_at` per review; `get_review_comments` exposes `author`,
`is_resolved`, `is_outdated` per thread). A `--follow-up` flag would have
been cheaper to build and something else to remember; the board says what
it detected, so a wrong detection is visible rather than silent. Detection
is skipped when the login is the PR author's: an author's own threads and
commented reviews are notes on their change, and treating them as a review
would demote findings on code nobody else has reviewed.

**Delta anchored on the last reviewed commit.** The user's latest submitted
review carries the commit it was made against. `reviewedCommit..headSha` is
exactly what changed since they looked, and the head checkout can diff it
with the same read-only git the specialists already use. The reviewed
commit is remote data validated to a SHA before it reaches a git command,
and after a force-push it may be missing or, if the old object survives
locally, no longer an ancestor of the head. Through 2.x only the verifier
touched this range: it checked `git merge-base --is-ancestor` once and, when
that failed, judged from current code with `delta.available` false, so nothing
was demoted. Since 3.0 the mod computes the delta once, in `prepare_review`
(the ancestry check, the commit count, and the changed hunks), and hands the
verifier the result: when it is unavailable the verifier judges from current
code and nothing is demoted. Specialists never see the delta and review the
full PR as on a first review.

**Demotion with a reason, not a higher bar.** "Be less picky" was first
modelled as raising the recommended threshold from confidence 80 to 90.
Rejected: specialist confidence is loosely calibrated, so a higher cut
mostly reshuffles findings at random. The signal that actually tracks
re-litigation is whether the finding's code changed since the user
reviewed it. The delta's changed hunks are computed once (by the verifier
through 2.x, by the mod since 3.0), and after synthesis each merged finding is
tagged (`changedSinceLastReview`) from its location in code; routing then demotes non-critical findings on
unchanged code to Other findings with a `routingNote`. Only a known-false
tag demotes; an unknown delta never does. An earlier cut had every
specialist run the delta git itself and tag its own findings, which meant
three separate ancestry checks and tri-state merge rules for duplicate
findings; tagging after the merge needs neither. Nothing is filtered out at
the source: the board shows the demoted finding and its reason, and the
user can promote it. Asking the board for "too picky" demotes every
non-critical recommended finding whose tag is not `true`, which includes
untagged ones, rather than applying a confidence cut, for the same
calibration reason.

**Overlap is an annotation, not a section.** 2.0–2.3 routed any finding
with `existingReviewOverlap.status === 'overlaps'` into a separate
"Related to existing threads" section regardless of severity, so a finding
that deserved posting was easy to miss beside the recommended list. Overlap
now stays on the item, decides only that a selected finding posts as a
thread reply, and is shown as a tag; `already_covered` still leaves
Recommended because posting it would be noise.

**The verifier judges which asks still apply.** It receives the user's
threads and the text of every review summary they submitted, oldest first,
and returns one verdict per thread and per summary ask that still stands.
An earlier cut decided in JS which summaries were still in force (latest
approve or request-changes and everything after, dismissed reviews
skipped); each review round found another GitHub state combination it
mishandled. Reading a sequence of reviews and telling which requests a
later one withdrew is a judgement call, and the verifier is already making
judgement calls. Code still picks the baseline commit, skipping the empty
COMMENTED review GitHub creates for each standalone thread reply so that
replying does not move it. The exception is a reviewer with threads and no
substantive review: an inline-only review is indistinguishable from a
reply, so the latest empty COMMENTED review is the baseline and a later
reply can move it.

**The verifier is a prompt, not an agent file.** Verifying the user's own
threads needs exactly the specialist's tool surface (read-only git, Read,
Grep, Glob) and nothing else, so it runs on
`pr-review-analysis-readonly` with its own prompt (and, since 3.0, its own
deposit tool) in the same fan-out. `parallel()` resolves a failed thunk to `null`, so a verifier
failure degrades to unverifiable verdicts instead of aborting the review.
Thread identity and state on each `P` item come from the collected thread
record; only the verdict comes from the verifier, so ids are stable whatever it
returns.

**Threads are awaited before the fan-out.** 2.3 awaited the collector after
the specialists so its latency hid behind theirs. The verifier runs in the
fan-out and needs the user's threads, so the await moved ahead of it. The
collector is a high-effort Haiku call running alongside the Sonnet selector,
which is awaited there anyway, so the added wait is small. Since 3.0 the
threads are collected in `prepare_review`, in code, in parallel with lens
selection and before the workflow starts, so nothing in the fan-out waits on
them.

## Mod hybrid (3.0.0)

**Why a mod.** Through 2.x everything between the preflight and the posted
review ran as model turns around one Workflow: Claude resolved the PR, rendered
the board as text, looped on its options, drafted, and previewed in the
conversation. Most of that is deterministic work done by a model, which costs
turns and tokens and drifts, and the preview was text the model re-typed, so
what you approved and what posted were two copies. 3.0 keeps the Workflow for
the one step that needs a model fan-out (the lens agents) and moves the rest
into a Claude Code mod in the same plugin: code runs the preflight, collection,
lens selection, synthesis, the board, and posting, and a pane replaces the text
board and the question loop. Claude makes two tool calls (`prepare_review`,
then `Workflow`) and stops.

**Platform facts the design rests on.** Most were observed on Claude Code
2.1.287 in a design session; the rest (the hook ordering and `agentId`
availability, the execution limits) come from the mods API types for that
build:

- A mod cannot start the Workflow tool: `$.tool.call` refuses it. The skill
  therefore stays the entry and Claude launches the workflow. A `tool.call` hook
  matched on `{ tool: 'Workflow', name: '<plugin>:<workflow>' }` fires only for
  that workflow, rewrites its `args` with `next({ ...e, args })`, and sees
  `result.taskId` in the answer. A launch by `scriptPath` has no `name` and
  bypasses the matcher.
- A normal plugin install registers the workflow by name; hot reload of a dev
  folder does not pick up a newly added workflow file.
- Agents inside a Workflow can call a mod-registered tool
  (`mcp__pr-review-toolkit__<name>`). The mod's `tool.call` hook receives each
  call with `e.agentId` and the arguments, and the string it answers with is
  what the agent reads. "Rejected, fix and call again" is a prompt convention:
  the agent's prompt has to say so. Workflow agents report to the workflow
  script, not the main conversation, so deposits add nothing to the transcript.
- A workflow's completion reaches the main conversation as a `prompt.attachment`
  of type `queued_command` while Claude is mid-turn, or as a `prompt.submit`
  with `origin.kind: 'task-notification'` when it is idle. The notice carries
  `<task-id>`, `<status>`, and the workflow's `<result>`. Rewriting it with
  `next({ ...e, text })` delivers only the new text; answering a `prompt.submit`
  without `next`, or with `{ drop }`, prints a transcript warning. Only the
  exact `<task-id>` tag counts, since an edited-file attachment can quote the id
  as plain text.
- `$.model.complete` is text-only, with no schema option: the mod strips code
  fences, parses, validates, and retries in code.
- `$.mcp.call('plugin:github:github', tool, args)` and `$.process.run` work
  from a mod.
- `TaskStop`, called through `$.tool.call`, stops a workflow by its `taskId`. A
  stopped workflow sends no completion notice, so cancel must update the run
  itself.
- Limits: a hook's own execution is bounded at 10 s (time inside `next` and `$`
  calls excluded), all `session.end` hooks together at 1.5 s, and
  `$.process.run` defaults to 30 s. `$.prompt.submit` resolves when the turn
  starts, so it is never awaited in a handler that can run while Claude works.
  Module variables are lost on reload, so state is recovered on `session.start`.
- Managed, Team, and Enterprise setups load a built-in guard that refuses a
  user-installed mod's tool registration while managed settings set
  `allowedMcpServers`, which breaks `prepare_review`, the deposit tools, and
  `set_drafts`; `allowManagedModsOnly` refuses the whole mod. That is why the
  mod is for personal machines only, with no fallback for surfaces that cannot
  draw a pane.

**One state object, pure logic, injected I/O.** The run is one
JSON-serializable object in `$.state` (session-only). The host follows `$` only
into a function declared in the same file: passing it to an imported function
is refused, both by `claude plugin validate` and at runtime. `read` and
`update` likewise need an atom declared in a `const` in the same file as the
hooks that use them. So there is no shared state module: `register.ts` and
`pane.tsx` each declare their own atom on the same key and build their own
`Io` with a local `makeIo($)`, and an update from one file redraws a pane in the
other. Everything under `hooks/lib/` is pure and never sees `$`; code that needs
a process, GitHub, or a model takes an injected `Io` (`run`, `mcp`, `complete`).
The same rule shapes the tests: lib code is tested against plain stub `Io`
objects, and since a test's `$` has no state noun, the pane's views are a pure
`view(run)` builder tested directly. Shared types live in a self-contained
`types/index.d.ts` (the validator rejects imports in it), re-exported for the
lib.

**Deposits, not workflow results.** Lens agents report by calling
`submit_findings` or `submit_followup`, correlated by a run nonce the launch
hook generates. The mod validates each submission against the lens roster and
the finding shape and answers `accepted` or `rejected` with what to fix; a
later valid submission for the same lens replaces the earlier one. The workflow
returns only whether each agent reported, so findings never travel through the
workflow's result or the completion notice. The nonce is stored before the
workflow starts, because agents may deposit at once, and a launch that did not
start gives it back. A lens with no accepted deposit counts as failed and is
named on the board, the same reduced-coverage disclosure as before.

**The preview is the plan that posts.** Accepting drafts fixes a posting plan:
each line comment is checked against the PR diff's hunks (git's default
context, which matches what GitHub shows, so a comment on a context line stays
inline), a line draft outside the diff, or whose diff could not be read, moves
into the review body, and the pane renders exactly that plan. Post sends the
plan and nothing else, and refuses when the run's plan or event differs by
value from what the pane rendered. Post is the sole approval, and it has no
single-letter shortcut: a pane that holds the keyboard presses a button by its
hotkey, so a stray letter must never be able to write to GitHub. Post, Approve,
and Cancel review are a click, or Tab and Enter, and the pane takes the
keyboard only from the person's own `/review-board`; an open the mod makes
itself never does.

**Posting is cautious about what it cannot confirm.** GitHub's MCP server
reports transport failures and 5xx answers, some given after GitHub acted, as
error results like any refusal. A write therefore counts as refused only when
its error shows a 4xx; any other failure counts as possibly posted and is never
sent again. A failed create deletes nothing, since the pending review GitHub
refused over may be the user's own. A run found posting after a reload ends as
done ("Posting was interrupted; check the PR.") and is never offered as a
postable preview again, and cancel is refused while posting.

**The Bash guard.** Lens agents run read-only git constantly, and each call
would otherwise prompt outside Auto mode. `tool.call` carries `agentId` and
`tool_use_id` and fires before `tool.check`, which carries no `agentId`, so the
`tool.call` hook remembers the id of a Bash call made by a subagent during an
active run, only while that call is in flight (`tool.check` fires inside the
hook's own `next(e)`), and the `tool.check` hook upgrades only those calls. The
command check is a whitelist over the words the shell would produce, not a
blacklist over the raw text (a first, regex-based version allowed
`git log & rm -rf x`): it accepts read-only git and `head`/`tail`, and
refuses expansions, globs, redirection, subshells, backgrounding,
backslashes, unterminated quotes, and git options that write a file, read from
outside the checkout, or run another program. It upgrades only Claude Code's
plain default `ask` to `allow`. A deny, an ask that one of the user's rules
produced, and a call carrying Bash input beyond `command`, `description`,
`timeout`, and `run_in_background` (a sandbox override, extra hosts) pass
through untouched, so a refusal costs a prompt and never a denial.

**Cancel and cleanup.** Cancel marks the run cancelled first, which turns late
deposits and drafts away, then stops the workflow with `TaskStop`. A cancel
pressed during the launch is kept, and the workflow that started anyway is
stopped. `session.end` (`/clear`, `/resume`, exit) drops the run and stops an
in-progress workflow without awaiting it, inside the 1.5 s bound. A cancelled
preparation cannot be launched, and the launch hook's denial tells Claude to
stop rather than prepare again.

**Accepted trade-offs.** One short Claude turn to launch the workflow and one
when it completes. No schema enforcement on `$.model.complete`, so JSON is
validated and retried in code. Lens selection reads the file list and churn,
not individual patches. No automatic retry of a failed lens: it is reported as
reduced coverage, as before.
