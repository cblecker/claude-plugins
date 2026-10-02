# Design Notes

Decisions behind the 2.x head-checkout architecture, recorded so future
changes do not re-litigate them blind. [README.md](../README.md) describes
what the review experience provides; this file records why it is provided
the way it is.

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
`get`, plus PR resolution via search/list), review threads (the collector
agent), and posting (the approved write step). Bulk data — the changed-file
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

## Agent tool surfaces

Skill `allowed-tools` constrains only the orchestrator (learning recorded
from PR #49) — workflow-spawned agents get their tools from their own agent
definitions. The synthesis agent runs with no
tools at all: it is fed the most untrusted text in the flow (finding
bodies, thread comments), and the agent holding the most untrusted input
should hold the fewest capabilities.

## Specialists: allowlist, no MCP

Through 2.2 the specialist agent was a *denylist* agent, so read-only MCP
(gopls and other language servers) stayed usable while the github plugin's
write surface was hard-denied. 2.3 makes it an allowlist of `Bash`, `Read`,
`Grep`, and `Glob`, based on transcripts of real runs:

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
scaled from the selector's changed-file count, or a `maxTurns` backstop —
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
thread descriptors come only from the collector's record for that id, so a
reply target always describes one real thread. The one place a rewrite adds
value is a merge of several lenses' findings, so only multi-finding groups may
carry a new title and claim. Indexes the synthesizer drops still land on the
board as their own items.

The token-overlap heuristic that used to classify overlap when synthesis
failed was removed with the merge machinery. It served only that rare path,
and a wrong word-overlap match could point a reply at the wrong thread.
Synthesis failure is instead disclosed (`reviewMeta.synthesisFailed`) and
findings are routed on severity and confidence alone. Synthesis is skipped
when there are no findings.

The workflow returns only what `board.md` and `posting.md` read: no PR
metadata (the orchestrator already has it), and already-covered and discarded
items without their long text fields. Specialists return `evidence` as one
string and fold their reasoning into `whyItMatters`, which shrinks every
later copy.

## Token efficiency (2.5)

A 2.5 audit looked for text that is multiplied: once per specialist, once per
agent turn, or once per later orchestrator turn. What changed:

- **PR body.** The body rides in every specialist's and the selector's prompt
  on every turn. The orchestrator leaves HTML comments out of the args, and
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
  and the collector records that reply targets come from are untouched.
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
- **Fewer orchestrator turns.** `get_me` and the board.md read ride along
  with the first GitHub call; fetch, merge-base, and the base-ahead count run
  as one chained Bash call (`HEAD..FETCH_HEAD` counts the same commits as
  `<merge_base>..FETCH_HEAD` and removes the dependency). PR resolution
  lists pass `fields: ["number", "head"]`, and the branch-config preflight
  reads only `merge` keys.
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
  and fail collection for the whole run.
- Dropping sub-50 findings at the source: contradicts disclosure and invites
  confidence inflation.
- Showing only changed entries on re-preview: weakens the exact-preview
  approval guarantee.

On the posting side, the line-anchor check runs one diff per distinct path,
batched in one turn, and a return to the check step reuses output already in
the conversation. Drafting straight into the preview needed no change: the
posting.md restructure already shows drafts only once, in the preview. A
lighter head re-check before posting (a filtered PR list instead of `get`)
was rejected: it saves little and adds a fallback path to the most
safety-sensitive step.

## Invocation: named plugin workflow, not `scriptPath`

The workflow script is registered in `plugin.json` under `workflows`, so the
skill launches it by name (`pr-review-toolkit:review-pr-analysis`) and Claude
Code loads the file as trusted plugin content. Claude Code 2.1.251 hardened
the Workflow tool to reject a `scriptPath` outside the session's readable set
(working directory and added directories), and the plugin cache is outside
that set; name-mode invocation is the supported path. The skill keeps a
`scriptPath` fallback for older versions that predate plugin workflows.

The workflow's `meta.name` is deliberately not `review-pr`: named workflows
surface as slash commands under `<plugin>:<workflow-name>`, and a workflow
named `review-pr` would shadow the skill's `/pr-review-toolkit:review-pr`
entry, dispatching bare workflow invocations without the skill's preflight
(PR resolution, head verification, base fetch, pinned merge-base).

## Follow-up mode

2.4 recognises a PR the user has reviewed before. Each choice below was the
lighter of the alternatives considered.

**Detection by login, not by argument.** The skill calls `get_me` once and
the workflow matches that login against thread authors and submitted
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
locally, no longer an ancestor of the head. Only the verifier touches this
range: it checks `git merge-base --is-ancestor` once and, when that fails,
judges from current code with `delta.available` false, so nothing is
demoted. Specialists never see the delta and review the full PR as on a
first review.

**Demotion with a reason, not a higher bar.** "Be less picky" was first
modelled as raising the recommended threshold from confidence 80 to 90.
Rejected: specialist confidence is loosely calibrated, so a higher cut
mostly reshuffles findings at random. The signal that actually tracks
re-litigation is whether the finding's code changed since the user
reviewed it. The verifier returns the delta's changed hunks once, and after
synthesis the workflow tags each merged finding (`changedSinceLastReview`)
from its location in JS; routing then demotes non-critical findings on
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
judgement calls. JS still picks the baseline commit, skipping the empty
COMMENTED review GitHub creates for each standalone thread reply so that
replying does not move it. The exception is a reviewer with threads and no
substantive review: an inline-only review is indistinguishable from a
reply, so the latest empty COMMENTED review is the baseline and a later
reply can move it.

**The verifier is a prompt, not an agent file.** Verifying the user's own
threads needs exactly the specialist's tool surface (read-only git, Read,
Grep, Glob) and nothing else, so it runs on
`pr-review-analysis-readonly` with its own prompt and schema in the same
fan-out. `parallel()` resolves a failed thunk to `null`, so a verifier
failure degrades to unverifiable verdicts instead of aborting the review.
Thread identity and state on each `P` item come from the collector record;
only the verdict comes from the verifier, so ids are stable whatever it
returns.

**Threads are awaited before the fan-out.** 2.3 awaited the collector after
the specialists so its latency hid behind theirs. The verifier runs in the
fan-out and needs the user's threads, so the await moved ahead of it. The
collector is a high-effort Haiku call running alongside the Sonnet selector,
which is awaited there anyway, so the added wait is small.
