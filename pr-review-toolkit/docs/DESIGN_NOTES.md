# Design Notes

Decisions behind the 2.x head-checkout architecture, recorded so future
changes do not re-litigate them blind. [README.md](../README.md) describes
what the review experience provides; this file records why it is provided
the way it is.

## Review the head, not the merge ref

GitHub's synthetic `refs/pull/N/merge` ref is lazily computed, absent when
the PR is conflicted, and stale after pushes — verified in practice: stale
test merges had `merge^2 != head`. Reviewing the merge result meant
translating merge-result line numbers to PR head line numbers before
posting, and made conflicted PRs unreviewable. 2.0 reviews the PR head
directly: findings anchor to head line numbers from birth, a
merge-conflicted PR reviews fine, and mergeability is a metadata signal on
the board. Integration breakage is CI's job; base movement is reported
honestly (`git rev-list --count <merge_base>..FETCH_HEAD`) instead
of analyzing GitHub's synthetic merge tree.

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
