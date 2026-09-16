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
definitions. The specialist agent stays a *denylist* agent so read-only MCP
(gopls and other language servers) remains usable; the denylist hard-denies
the github plugin's entire write surface, audited against the
github-mcp-server toolsets the plugin enables. Re-audit that list whenever
the github plugin dependency updates. The synthesis agent runs with no
tools at all: it is fed the most untrusted text in the flow (finding
bodies, thread comments), and the agent holding the most untrusted input
should hold the fewest capabilities.

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

## Native Codex Port

Codex keeps the same specialist review, thread-aware board, and selected-feedback
conversation in an instruction-led skill. Native subagents provide isolated
conversation contexts and execution lifecycle; the parent selects lenses,
clarifies findings, and synthesizes the board. The separate Claude Workflow
continues to evolve independently.

PR preparation fetches over HTTPS and pins head/base/merge-base without creating
checkouts or updating shared `FETCH_HEAD` or refs. Its compact version-2 JSON
records canonical source and common Git paths, source HEAD, and PR identity.
Descriptive PR metadata comes from MCP. The launcher scopes its alias-resolved
authentication token to preparation and passes the JSON inline in one prompt.

Native Codex worktrees own creation, retention, and cleanup. The launcher enables
worktrees per invocation and starts from the source path; CLI 0.154.0 or later is
required, with no version gate or legacy fallback. A guarded helper checks the
new checkout is clean, detached, linked to the recorded repository, and at the
source or PR head before selecting the pinned PR head without force. Repository
guidance is read after that transition. Direct skill invocation uses an existing
clean PR-head checkout without switching it.

The conversation retains the actual review checkout, pins, board, and drafts.
Resume validates that same checkout and pinned range without repeating the
transition. The launcher preserves Codex's exit status and does not delete
worktrees on exit or failed startup. There are no temporary handoff files,
session-directory helpers, or cleanup traps. Older toolkit worktrees receive no
automatic migration or deletion.

Normal Codex session settings govern permissions; review-only instructions are
not per-stage enforcement. There is no custom profile, worker pool, schema/board
processor, or subprocess fallback. Exact previews and PR head checks remain
requirements for posting, with progress tracked in the conversation.
