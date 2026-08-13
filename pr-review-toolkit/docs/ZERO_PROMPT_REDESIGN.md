# PR Review Toolkit: Zero-Prompt Redesign

Status: design decisions resolved; ready for implementation. This document
supersedes `WORKFLOW_REWRITE_PLAN.md` and `WORKFLOW_REWRITE_CONTEXT.md`.
`PR_REVIEW_REQUIREMENTS.md` remains authoritative; this change amends
its two GitHub-data-transport clauses (API data via MCP; repository
content via read-only local git), recorded in Resolved Design
Decision 6.

Audience: the engineer implementing the rewrite. This document specifies
intent — goals, invariants, component roles, and control flow. Anything
finer-grained is an implementation-time decision. Evidence for settled
choices is compressed into Resolved Design Decisions at the end; do not
re-litigate them without new evidence.

Scope: the `review-pr` skill and its components. `address-pr-feedback`
is out of scope and unchanged.

## Design Goal

Run fully automated with **zero tool permission prompts** from invocation
through the review board and interactive drafting loop. The **only
sanctioned GitHub write is posting the approved review**, behind an exact
preview and explicit user approval. Everything before that gate is
read-only outside the toolkit's own footprint: fetched objects, one
worktree registration, one ephemeral workspace.

Invariants:

- **The user's checkout is never mutated.** `git status`, branch, and
  index are identical before and after a review, including failed ones.
  No refs or branches are ever created in the user's repository.
- **Every git-state mutation goes through a git subcommand.** Never
  `rm -rf` (the permission layer blocks it everywhere; git subcommands
  run prompt-free). Non-git writes are confined to the workspace: the
  `mktemp` root the builder creates — no component writes any other
  file.
- **No component pushes, commits, or writes GitHub** except the skill's
  approved posting step.
- **Findings are anchored to PR-head line numbers from birth.** There is
  no line-number translation anywhere.

## Precondition

The skill must run from a clone with a remote that resolves to the PR
base repository — any remote name; fork setups with the base repo as
`upstream` are first-class. Remote URLs come in several forms —
`https://github.com/owner/repo[.git]`, `git@github.com:owner/repo[.git]`,
`ssh://git@github.com/owner/repo[.git]` — and matching must normalize
all of them (case-insensitively) to the same owner/repo identity. No matching remote → error immediately,
naming the base repo and the fix. There is no clone-from-scratch mode
and no MCP bulk-data fallback. Authentication is inherited from the
matched remote; the toolkit never handles tokens.

## Background

The current implementation was built for manual permission mode and
carries three compensations that are now liabilities: an in-place
checkout script that mutates the user's worktree (~250 lines of guard
plumbing), a merge-ref checkout that forces error-prone line-number
translation before posting, and MCP as the bulk-data channel (hundreds
of lines of pagination/retry sensitive to output-token limits). The
review board taxonomy, specialist lenses, overlap classification, and
preview/approve/post discipline all work well and carry forward
unchanged.

## Architecture

Six components, each with one job:

| Component | Role | Writes to |
|-----------|------|-----------|
| `skills/review-pr/scripts/workspace.sh` | Workspace builder: worktree of the PR head in temp space, pinned SHAs, merge signal | Workspace + git metadata, via git subcommands only |
| `skills/review-pr/SKILL.md` | Interactive controller: verify, launch workflow, present board, draft, preview, approve, post | GitHub (approved posting only) |
| `skills/review-pr/review-pr.js` | Analysis orchestrator: reviewer selection, agent fan-out, board assembly | Nothing |
| `agents/pr-review-collector.md` | GitHub MCP reader: review threads | Nothing |
| `agents/pr-review-specialist.md` | Read-only analysis in the workspace | Nothing |
| `agents/pr-review-synthesis.md` | Tool-denied board synthesis from prompt JSON | Nothing |

`pr-review-collector` renames `pr-review-github-collector` (update the
workflow's `agentType` reference); `pr-review-specialist` replaces
`pr-review-analysis-readonly`; `pr-review-synthesis` is new. Renamed
agents make this a major version bump. These stay plugin-defined
agents rather than built-ins (Explore, Plan) deliberately: the whole
point of each profile is a tool boundary the plugin pins — write
tools excluded, synthesis tool-free — and built-in definitions evolve
with the harness outside the plugin's control.

Only the skill's main conversation may invoke GitHub write tools, and
only in the approved posting step. All three agents structurally exclude
GitHub write tools: collector and synthesis via `tools:` allowlists
(collector lists its one read tool; synthesis lists none), the
specialist via a `disallowedTools` denylist (an allowlist would block
repo-varying read-only tools like language servers). Enumerate the full
current GitHub write-tool surface in that denylist at implementation
time and re-audit it when the github plugin updates.

## Component: Workspace Builder (`scripts/workspace.sh`)

Replaces `checkout.sh`. One small deterministic script with one job:
build the workspace during skill preprocessing and emit the pinned
facts. Everything after that — base resolution when deferred, the
changed-file list, diffs — is ordinary git run by the skill or the
specialists in the workspace.

Invoked in the skill body exactly as `checkout.sh` is today:

```markdown
- Workspace: !`bash "${CLAUDE_SKILL_DIR}/scripts/workspace.sh" setup "$pr-url"`
```

The harness runs this while assembling the prompt; the model never
invokes setup itself, and the skill body must say so. Running as one
pre-approved command is what turns sandbox EPERMs into `WORKSPACE_ERROR`
instead of permission prompts. `$pr-url` is input the user typed into
their own session — not an external injection channel; external values
(remotes, SHAs) never ride this substitution.

Two harness properties are **gating preconditions** — test them before
shipping, because no documentation specifies them:

1. Skill-argument substitution into preprocessing commands must be
   shell-safe (test with a metacharacter-bearing argument). If it is
   raw, do not ship this interface: split setup into an argument-less
   preprocessing preflight plus a model-issued, pattern-allowed setup
   call whose URL argument the skill validates first.
2. Preprocessing must tolerate a long-running command (the setup path
   can legitimately span minutes on a large repo). If it enforces a
   short ceiling, use the same contingency.

Setup steps, in order:

1. **Validate the PR URL**; extract owner, repo, number. Reject
   anything that is not a plain GitHub PR URL.
2. **Locate the source remote.** Scan all remotes for one whose URL
   resolves to the base repository — match host *and* path (PR URLs are
   always `github.com`; never fetch a same-named repo on another host).
   Prefer `origin`, else first in `git remote` output. Validate the
   selected remote name against the remote pattern (below) here, before
   it is ever interpolated — a leading-hyphen remote name would parse
   as an option. Fail as `WORKSPACE_ERROR`: no match, not a git repo,
   shallow clone ("run `git fetch --unshallow`" — merge-base needs full
   ancestry), or partial/promisor clone (implicit lazy fetches would
   violate the single-remote model).
3. **Hygiene.** Run `git worktree prune` (plain — git's default
   expiry), clearing registrations left stale by temp cleanup of prior
   workspaces. This is the same prune the user's own `git gc` runs.
4. **Discover and pin.** One `ls-remote` reads both PR refs without
   writing any local state:

   ```bash
   git ls-remote <remote> "refs/pull/N/head" "refs/pull/N/merge"
   ```

   The SHAs arrive as one snapshot. Missing merge line = conflicted or
   not-yet-computed test merge (exit 0, verified). Missing head line =
   PR not on this remote: `WORKSPACE_ERROR`. Pin `head_sha` (and
   `merge_sha` if present) as script variables. Then fetch **by SHA**:

   ```bash
   git fetch --no-tags --recurse-submodules=no \
     <remote> "$head_sha" [ "$merge_sha" ]
   ```

   GitHub accepts SHA wants and this creates zero local refs
   (verified; `FETCH_HEAD` is transiently rewritten as in any fetch —
   nothing in the toolkit reads it). `--no-tags` stops tag
   auto-following from creating refs in the user's repo;
   `--recurse-submodules=no` matters because the fetch default is
   *on-demand* — fetched commits that update submodule gitlinks would
   trigger fetches of other remotes. A
   force-push between `ls-remote` and fetch fails the fetch honestly;
   re-running picks up the new state.

   No prompt-suppression or timeout machinery: this is an interactive
   flow, credentials come from the remote the user already fetches
   from, and a hung network command is bounded by the harness's own
   command timeout, surfacing as an honest failure.

   With objects local: `base_sha=$(git rev-parse "${merge_sha}^1")` —
   the merge ref's first parent is the base tip. Check `${merge_sha}^2`
   against `head_sha`: a mismatch means the test merge is **stale**
   (GitHub recomputes lazily; after a rebase a stale `merge^1` predates
   the true fork point and would corrupt the file list). Treat stale
   exactly like absent: record it, discard `base_sha`, and leave base
   resolution to the skill (step 3 of its flow).
5. **Create the workspace**, fresh every invocation:

   ```bash
   ws=$(mktemp -d -p "${TMPDIR:-/tmp}" "pr-review-<owner>-<repo>-<N>.XXXXXXXX")
   git -c core.hooksPath=/dev/null -c core.sparseCheckout=false \
     worktree add --detach "$ws/checkout" "$head_sha"
   ```

   `--detach` is explicit intent (a raw SHA detaches anyway): no
   branch is ever created, and concurrent sessions can hold the same
   commit without "already checked out" conflicts.

   `worktree add` is not atomic: on failure, run
   `git worktree remove --force` on the path just attempted (the one
   sanctioned removal; `--force` because plain `remove` refuses a
   dirty or partially-populated worktree — exactly what a failed
   checkout leaves) and report manual recovery in the
   `WORKSPACE_ERROR` if that also fails.

   The two overrides disable the checkout hazards that matter:

   - **Hooks**: `post-checkout` runs on `worktree add` →
     `core.hooksPath=/dev/null`.
   - **Sparse checkout**: repository-shared `core.sparseCheckout`
     silently omits tracked files from the new worktree (verified) →
     force-disabled so the analysis tree is complete.

   Content filters (LFS included) run exactly as they would for the
   user's own checkout, with the user's own configuration and
   credentials.

   The workspace contains only `checkout/` — the toolkit writes no
   artifact files.

   `mktemp -p` works identically on GNU and BSD/macOS (verified;
   modern BSD documents it). `${TMPDIR:-/tmp}` is correct in both
   harness environments (verified: local Claude Code exports a
   sandbox-writable `TMPDIR`; web leaves it unset with a writable,
   container-isolated `/tmp`). Do not add environment detection, and
   do not pre-verify writability — an unwritable root fails inside the
   script as `WORKSPACE_ERROR`, never a prompt.

   Lifecycle: the builder mutates only the directory it just created.
   No component calls `git worktree remove` in normal operation — an
   interactive session has no well-defined end, so directory cleanup
   belongs to the OS temp reaper and stale registrations to prune
   (step 3 — cleared once git's normal expiry passes). `worktree
   remove` is the documented manual-recovery primitive.
6. **Compute merge-base** (skipped when deferred):
   `merge_base=$(git merge-base "$base_sha" "$head_sha")`, and
   `baseAhead` via `git rev-list --count`.
7. **Emit the output block.**

### Output contract

Setup emits one machine-readable format, owned by the script:

- Failure: one line, `WORKSPACE_ERROR: <reason>`, with an actionable
  reason. An error trap guarantees the line even on unanticipated
  failures (reachable: `git merge-base` fails on unrelated histories,
  which are formally out of scope — the honest error is the specified
  behavior). The skill treats anything that is neither `WORKSPACE_OK`
  nor `WORKSPACE_ERROR` as an error. There is no degraded path — do
  not reuse the name `CHECKOUT_SKIP`; nothing is skipped, it fails.
- Success: `WORKSPACE_OK`, then `key value` lines: `workspace`,
  `remote`, `headSha`, `baseSha`, `mergeBase`, `baseAhead` (commits
  merge-base→base tip, the board's "base has moved" count), and
  `mergeRef` (`present`/`absent`/`stale`). Keys unresolved on the
  deferred path emit `-`.

### Why a script

Not permission batching (auto mode makes direct git prompt-free). Three
reasons: remote-URL normalization must be deterministic and testable,
not re-derived by a model each run; preprocessing substitution puts
the workspace, SHAs, and merge signal in place before the model
generates a token; and the output contract needs a single owner
(instructed prose is how the current SKILL.md accumulated parsing
rules). Guard: the
script must never grow logic that competes with git — it is URL
parsing, a remote loop, a handful of git subcommands, and printf.

## Component: Skill (`review-pr/SKILL.md`)

Flow, in order:

1. Parse the PR URL; read the builder output. On `WORKSPACE_ERROR`,
   report and stop.
2. Fetch metadata via `pull_request_read` (`get`). Verify workspace
   `headSha` against GitHub's. Mismatch = head moved during setup:
   fail honestly, tell the user to re-run.
3. Resolve the base when setup deferred it, or when metadata
   `base.sha` differs from setup's `baseSha` — recompute on *any*
   difference (an ancestry check cannot detect the base absorbing the
   PR's own commits, which moves the fork point):

   ```bash
   git fetch --no-tags --recurse-submodules=no <remote> <base.sha>
   git -C <workspace>/checkout merge-base <base.sha> <headSha>
   git -C <workspace>/checkout rev-list --count <merge-base>..<base.sha>
   ```

   Same fetch flags as setup; no second `ls-remote` — `base.sha` comes
   from the same API snapshot as the head verification, so nothing
   races a moving ref. Before interpolating, the skill validates:
   `<remote>` must byte-match setup's emitted `remote`, `<base.sha>`
   must byte-match metadata `base.sha` and `^[0-9a-f]{40}$`. These
   checks are the model following instructions — stated this precisely
   for exactly that reason.
4. Build the changed-file list, in the workspace:

   ```bash
   git -C <workspace>/checkout -c core.quotePath=false --no-pager \
     diff --name-status --find-renames <merge-base> HEAD
   git -C <workspace>/checkout --no-pager \
     diff --numstat --find-renames <merge-base> HEAD
   ```

   Join into `{path, status, additions, deletions}` records for the
   workflow `args` (rename records carry old and new paths; numstat
   shows `-` for binary files — categorization maps those).
   `core.quotePath=false` keeps non-ASCII paths literal; truly
   pathological names (embedded quotes, control bytes) still C-quote
   and are rare enough to accept. On PRs large enough to truncate
   command output, page it (`| sed -n '<start>,<end>p'`) until the
   list is complete — completeness is checked against
   `git diff --name-status | wc -l`, and only per-file numstat detail
   may be dropped, disclosed in `reviewMeta`.
5. Compute the full diff in the workspace:

   ```bash
   git -C <workspace>/checkout --no-pager diff \
     --no-ext-diff --no-textconv --no-color -U3 --find-renames \
     --src-prefix=a/ --dst-prefix=b/ <merge-base> HEAD
   ```

   The flags keep user config (`diff.external`, `diff.noprefix`,
   `color.ui=always` — verified to break header parsing — pagers,
   `diff.renames=false`) from reshaping the output. What must hold is
   line-anchor equivalence with GitHub: both sides diff the same two
   trees, so head line numbers are directly postable. The 200K-char
   cap gates prompt inclusion only: truncate at a hunk boundary, flag
   it in `args`, surface it in `reviewMeta`; the checkout is complete,
   so specialists can recompute anything dropped. Then launch the
   workflow. The skill writes no files — everything the workflow and
   specialists need travels via `args` and the workflow-built
   prompts.
6. Present the review board and run the interactive loop exactly as
   the current SKILL.md specifies. Merge-signal notes: `mergeRef` not
   `present` → interpret via API mergeability (`mergeable: null`
   means still computing — say so); positive `baseAhead` → "base has
   moved N commits" note.
7. Preview and approval: unchanged. Exact preview of every comment,
   body, and event; explicit approval via `AskUserQuestion`.
8. Post via GitHub MCP write tools after one final guard: re-fetch
   metadata; a changed `headSha` aborts outright; a changed `base.sha`
   triggers the step-3 commands again — abort only if the recomputed
   `mergeBase` differs from the reviewed one (fork point moved;
   anchors shifted). Bind the pending review to the reviewed head via
   the write tool's `commitID` parameter. The narrow check-then-act
   window between guard and submission is an accepted residual. This
   is the only GitHub write in the system.

Deleted from the current SKILL.md with no replacement: the manifest
parsing and C-quoted-path rules ("read the builder's structured
output" replaces them), the entire line-number translation section
(findings are head-anchored by construction; comments that miss the
PR diff go to the review body, as today), and the manual-mode/plan-mode
preamble.

## Component: Workflow (`review-pr.js`)

Expected to shrink to roughly a third of its ~1,850 lines. Keeps:

- **Reviewer selection** from the categorized file list (same rules,
  same lenses; categorization stays deterministic JS, fed via `args`).
- **Collector fan-out**: one call for review threads (metadata comes
  from the skill via `args`).
- **Specialist fan-out**: selected specialists in parallel; each
  prompt carries the metadata subset, lens instructions, thread
  context, and the workspace path.
- **Synthesis** via the `pr-review-synthesis` agent (never the
  specialist profile): dedup, overlap classification, board assembly
  with the existing section taxonomy. `reviewMeta` is assembled by
  deterministic workflow JS after synthesis (as `finalizeBoard` does
  today) from flags the skill passes — the agent cannot know what the
  skill dropped.
- **Diff-header path unquoting** (`unquoteGitPath`): patch text has no
  `-z` form, so `+++ b/<path>` headers still C-quote; this decoder
  stays.

Sheds: all `get_files` pagination/recovery, the MCP-manifest fallback
path, manifest verification counts. Nothing may depend on
`MAX_MCP_OUTPUT_TOKENS`.

Workflow `args` carries: owner/repo/number; the metadata subset
(title, body, author, state, review decision, `headSha`, `base.ref`,
`base.sha`); the file-list records `{path, status, additions,
deletions}`; the capped `fullDiff` plus truncation flag; the workspace
path; and provenance (`mergeRef`, `baseAhead`). This
is the only transport into the workflow — workflow scripts cannot read
files or run git, so `args` is the floor, and specialists reach bulk
data through the workspace directly.

## Component: Agents

**`pr-review-collector`** — the current collector renamed: GitHub PR
read tools only (allowlist), no shell, no files; scope shrinks to
review threads.

**`pr-review-specialist`** — replaces `pr-review-analysis-readonly`
with one deliberate expansion: read-only git against the workspace
checkout (`git -C <workspace>/checkout log|blame|show|diff` — never
`cd`), because history is genuinely valuable review context and the
old design excluded it only for permission-UX reasons. Required
command hygiene, stated verbatim in the agent definition: hardened
diff flags (`--no-ext-diff --no-textconv --no-color`), pagers off;
PR-controlled
paths go after a literal `--`, and a path may appear as a shell
operand only if it matches `^[A-Za-z0-9._/ -]+$` — otherwise inspect
it with Read/Grep, which pass paths outside the shell. The definition
hard-denies file mutation, `Task`, web tools, and all GitHub write
tools, and confines shell use to the read-only git forms above (this
subsumes the old "no generated parsing scripts" rule).

**`pr-review-synthesis`** — new, narrowest profile: no tools at all.
Synthesis works entirely from prompt JSON and returns structured
output; it is also the agent whose input is mostly untrusted text
(finding bodies, thread comments), which is exactly the agent that
should hold no capabilities. The current workflow's prompt-level "do
not call tools" becomes structural.

## End-to-End Flow

```text
claude "/pr-review-toolkit:review-pr <pr-url>"   (from any clone with a
  |                                               remote matching the base
  |                                               repo; otherwise: error)
  |-- preprocessing: workspace.sh setup
  |     remote scan -> ls-remote (pin SHAs) -> fetch by SHA
  |       -> mktemp -> worktree add (hooks off, detached)
  |       -> merge-base (or: deferred to skill)
  |     emit: WORKSPACE_OK block (or WORKSPACE_ERROR)
  |
  |-- skill: pull_request_read(get) -> verify headSha
  |-- skill: git fetch base + merge-base (if deferred or base moved)
  |-- skill: git diff --name-status/--numstat (file list -> args)
  |-- skill: git diff <merge-base> HEAD in workspace (head-anchored)
  v
Workflow(review-pr.js)
  |-- collector agent --------- MCP: review threads
  |-- specialist agents (par) - Read/Grep + read-only git in workspace
  |-- synthesis agent --------- dedup, overlap, board assembly (no tools)
  v
skill: present review board (incl. merge-signal note when not clean)
skill: interactive loop (challenge / select / draft)      <- user judgment
skill: exact preview + AskUserQuestion approval           <- the gate
skill: post review via GitHub MCP write tools             <- only write
```

## Merge-Result Awareness

The head checkout gives up seeing the code as it will land. The merge
ref returns in two bounded roles only: as a **pointer** (`merge^1`
locates the base tip) and as a **signal** (absence + API mergeability →
conflict note; `baseAhead` → "base has moved N commits" note). Never as
*content*: nothing is checked out from it and no finding ever anchors
to merge-ref line numbers. The moment merge awareness needs its own
checkout, it has rebuilt the thing this redesign deleted.

## Permission Model

Guard outcomes, not capabilities:

- **Target is auto permission mode.** Read-only and git-native
  workspace operations run prompt-free — verified empirically,
  including a 29k-file checkout and SSH fetches, from the main
  conversation; verify specialist *subagents* get the same treatment
  during implementation (fallback: deny specialist Bash). The skill
  must not require manual mode.
- **`rm -rf` is blocked at the permission layer regardless of target;
  git subcommands doing equivalent deletions run prompt-free**
  (verified). Hence the git-native-mutation invariant.
- **`allowed-tools` is defense in depth**: the setup invocation (kept
  so stricter modes cannot break preprocessing), a `git fetch` pattern
  for the skill's base-resolution fetch, read-only git patterns by
  subcommand, the GitHub
  tools the skill uses, `AskUserQuestion`/`Workflow`/`ExitPlanMode`
  (exit plan mode first if active). Verify `${CLAUDE_SKILL_DIR}`
  expansion inside patterns during implementation.
- **The GitHub write boundary is structural** (tool exclusion in all
  three agent definitions). **Specialist "read-only git" is
  instruction-level** — frontmatter can't express it (Bash is
  all-or-nothing; read-only subcommands accept `--output`; static
  patterns can't pin an ephemeral path). Note the workspace is a
  linked worktree sharing the user's object/ref store: "disposable"
  bounds filesystem damage, not git-state damage. If that residual is
  unacceptable in a deployment, re-denying specialist Bash is a
  one-line lever.
- **Posting authorization is behavioral.** Write tools are listed for
  the whole skill lifetime (the harness cannot phase tool exposure),
  so they are technically callable before the gate; the approval gate
  is conversational. Bounded by the agent boundary: bulk untrusted
  content is processed by write-denied agents, and only their
  structured output reaches the write-capable conversation. Removing
  the write tools from `allowed-tools` is the structural-gate lever —
  one harness prompt, at the one write.
- **Sandbox denials fail the build honestly.** If the protected-path
  stress test (a PR touching a tracked `.claude/` path) shows real
  EPERMs, the behavior is still `WORKSPACE_ERROR` — no mitigation is
  pre-sanctioned, and sparse-checkout exclusion specifically is ruled
  out (incomplete tree, and `git sparse-checkout` in a linked worktree
  mutates shared repo config). What must never return is a parallel
  implementation of git checkout.

## Data Flow

git is the bulk channel; MCP is the metadata channel.

| Data | Source | Consumer |
|------|--------|----------|
| Changed-file list | `git diff --name-status`/`--numstat`, run by skill in workspace | Workflow via `args`; specialists re-derive as needed |
| Full PR diff | `git diff` in workspace | Specialists (capped inline; recomputable) |
| File contents, history | Workspace (Read/Grep/read-only git) | Specialists |
| Base location, merge signal | Merge ref parents; API mergeability | Builder, board note |
| PR metadata | `pull_request_read` (get) | Skill → workflow `args` → specialist prompts |
| Review threads | MCP via collector agent | Workflow synthesis |
| Review posting | MCP write tools | Skill, approved step only |

There are no artifact files at all: metadata and the file list ride
`args`, and the workflow builds specialist prompts from them plus the
workspace path. Threads are collected inside the workflow
and reach specialists inline (they are small). Categorization is
deterministic workflow JS, never model judgment. Large-PR philosophy
is unchanged: complete file list always, low-signal areas summarized,
attention where signal is highest, truncation always disclosed.

## What Is Deleted

The explicit kill list, so nothing survives out of inertia:

- `checkout.sh`: protected-path pathspecs, skip-worktree bookkeeping,
  untracked-overwrite guards, restore-on-failure machinery (~250 of
  289 lines).
- SKILL.md: line-number translation, manifest parsing / C-quoted-path
  rules, the manual-mode/plan-mode preamble, origin-must-match.
- `review-pr.js`: `get_files` pagination and recovery, MCP-manifest
  fallback, manifest verification counts, the PR-metadata collector
  call.
- README: wrapper-function-era guidance (dedicated worktree, origin
  remapping) — replaced by "run from any clone with a remote for the
  base repo".

## Accepted Residuals

Stated once, not claimed away:

- Posting gate is behavioral (see Permission Model); structural lever
  documented.
- Specialist read-only git and the skill's byte-equality argument
  checks are instruction-level; structural lever documented.
- The specialist denylist admits future unlisted GitHub write tools
  until re-audited.
- Checkout content transforms (line endings, LFS and other
  `.gitattributes` filters) run as they would for the user's own
  checkout; line anchors are unaffected because diffs and the file
  list are computed tree-to-tree.
- Network hangs are bounded only by the harness's command timeout —
  no toolkit-level watchdog.
- The check-then-act window between the pre-posting guard and
  submission.

## Success Criteria

1. `claude "/pr-review-toolkit:review-pr <url>"` produces a review
   board with zero permission prompts under auto mode, from a base-repo
   clone and from a fork clone with the base as `upstream`; from a
   non-matching directory it errors immediately with no partial work.
2. The user's checkout is untouched — status, branch, index identical
   before and after, including after mid-review failures. No refs, no
   `rm -rf` anywhere.
3. No line-number translation exists anywhere; posted comments land
   correctly because findings are head-anchored.
4. The `claude-review-pr` shell wrapper is obsolete (secret injection
   moves to the github plugin's MCP config — companion change, out of
   scope here).
5. The only GitHub write in any transcript is the approved posting
   step, always preceded by exact preview and explicit approval.
6. Nothing depends on `MAX_MCP_OUTPUT_TOKENS`.
7. The review board, interactive loop, drafting, and preview
   discipline satisfy `PR_REVIEW_REQUIREMENTS.md` unchanged.

Validation: reuse the representative-PR matrix in the README, plus:
both invocation contexts and the no-remote error; head moves during
setup (honest error); re-invocation (fresh workspace; old
registrations cleared by prune after git's normal expiry); two
concurrent sessions on the same
PR; merge ref absent (skill resolves base from metadata + board
note); merge ref
stale after a push (`merge^2` ≠ head — must defer); base advanced
(note + recompute); head force-pushed before posting (guard aborts);
shallow/partial clone (precondition error); an LFS repo (checkout
smudges via the user's own LFS setup); sparse-checkout clone (complete
worktree); a control-byte/non-UTF-8 path (honest refusal); the tracked
`.claude/` sandbox stress test; and the gating checks — substitution
shell-safety, preprocessing duration, `${CLAUDE_SKILL_DIR}` pattern
expansion, specialist-subagent prompt-freedom.

## Resolved Design Decisions

Empirical evidence backing the settled choices (a real macOS session
in auto mode, fork clone of a large repo; live GitHub PR refs): SSH
fetch of `refs/pull/N/head`, a 29k-file worktree build in temp, and
Read/log/blame in it all ran with zero prompts; `rm -rf` was
consistently denied while `git worktree remove` ran prompt-free;
`ls-remote` snapshots tolerate a missing merge ref; fetch-by-SHA is
accepted by GitHub and creates zero local refs; unqualified refspec
destinations become visible branches (why named temp refs were
abandoned); `core.quotePath=false` yields literal non-ASCII paths
(only pathological names still C-quote);
`color.ui=always` corrupts non-tty diff output; shared
`core.sparseCheckout` makes new worktrees sparse; `mktemp -p` works on
GNU and BSD/macOS.

1. **MCP bulk-file fallback: deleted.** Git is the only data path;
   when the workspace cannot be built the review fails with the
   reason. A fallback that runs rarely is broken when needed, and its
   use cases (dirty worktree, wrong origin, forks) no longer exist.
2. **Workspace: fresh mktemp-unique worktree per invocation; git-native
   operations only; no removal in normal operation; plain
   `worktree prune` at setup for hygiene** (default expiry — the same
   prune the user's own `git gc` runs; `--expire now` was rejected as
   able to clear a user's own registration on a temporarily unmounted
   volume). Rejected: shared-object clones (no git subcommand deletes
   a clone) and deterministic PR-keyed paths (shared mutable state).
3. **Clone-from-scratch and its auth story: removed by precondition.**
   Credentials are inherited from the user's working remotes; the
   toolkit never touches tokens.
4. **Merge awareness: pointer and signal, never content.** Deferred:
   semantic-conflict cross-referencing.
5. **SHA-only transport.** `ls-remote` pins both PR SHAs into script
   variables; objects are fetched by SHA; no local refs ever exist, so
   concurrent sessions cannot interfere and there is nothing to clean
   up. Replaced a named-temp-ref design whose shared refs raced
   concurrent sessions. Base resolution: `merge^1` when the merge ref
   is present and `merge^2` matches the head; otherwise the skill
   resolves the base itself, driven by API `base.sha`. Recompute on any
   base movement (ancestry checks cannot detect the base absorbing PR
   commits).
6. **Enforcement honesty.** Structural denial covers what tool names
   can express; specialist git hygiene and argument validation are
   instruction-level and labeled as such; sandbox tolerance is
   fail-honest with no pre-sanctioned mitigation. The two
   `PR_REVIEW_REQUIREMENTS.md` GitHub-data clauses are amended to
   match (narrowed to API data; repository content travels over
   read-only local git). The Safety clause "analysis should avoid
   tools capable of modifying the repository unless the user
   explicitly requests a different workflow" stands unamended: this
   design is that explicitly requested workflow, and the specialists'
   read-only-git contract honors its intent.
