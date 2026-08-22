# Design Notes

Decisions behind the 2.0 head-checkout architecture, recorded so future
changes do not re-litigate them blind. `PR_REVIEW_REQUIREMENTS.md` governs
what the review experience must provide; this file records why 2.0 provides
it the way it does.

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

## Impact from a skeptic, not the finder

Every board finding answers "what would actually happen if this shipped
unaddressed" (`unaddressedImpact`), and that answer deliberately does not
come from the specialist that raised the finding. A specialist's
`whyItMatters` is advocacy by construction — the agent that just found an
issue justifies it — and the synthesis agent is tool-free, so it could only
paraphrase that advocacy. Impact therefore comes from a separate assessor
stage after synthesis: it reuses the read-only analysis agent type so it can
verify claims against the checkout, it is prompted to deflate ("negligible"
is an accepted verdict), and it is fed the claim, evidence, and location but
*not* the specialist's severity, confidence, or why-it-matters text, so it
cannot anchor on the inflation it exists to correct. Only actionable
sections are assessed (recommended, related, discussion-worthy) in chunks of
8 findings per agent, keeping the stage at roughly one extra agent per
review. Assessment is presentation-only: a negligible tier never re-routes
or drops a finding — severity-vs-impact disagreement is surfaced to the
human reviewer, not resolved silently — and incomplete coverage is disclosed
in `reviewMeta.impactAssessment` instead of hidden.

## Agent tool surfaces

Skill `allowed-tools` constrains only the orchestrator (learning recorded
from PR #49) — workflow-spawned agents get their tools from their own agent
definitions. The specialist agent stays a *denylist* agent so read-only MCP
(gopls and other language servers) remains usable; the denylist hard-denies
the github plugin's entire write surface, audited against the
github-mcp-server toolsets the plugin enables. Re-audit that list whenever
the github plugin dependency updates. The synthesis agent runs with no
tools at all: it is fed the most untrusted text in the flow (finding
bodies, thread comments), and the agent holding the most untrusted input
should hold the fewest capabilities.
