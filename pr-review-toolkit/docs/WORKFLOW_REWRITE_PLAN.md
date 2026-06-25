# PR Review Toolkit Workflow Rewrite Plan

This plan describes how to implement the requirements in
`docs/PR_REVIEW_REQUIREMENTS.md` using a Workflow-backed analysis engine and a
skill-driven interactive review loop.

## Target Model

Use Workflow orchestration for the non-interactive analysis phase, and keep the
human co-review loop in the main skill conversation.

```text
/pr-review-toolkit:review-pr <github-pr-url>
  |
  |-- Skill: parse arguments and launch analysis workflow
  |
  |-- Workflow: collect, analyze, synthesize
  |     |
  |     |-- collect PR metadata and review context via GitHub MCP reads
  |     |-- collect PR diff metadata via a verified local git source when possible
  |     |-- fall back to GitHub MCP file reads plus a bundled parser when needed
  |     |-- build a whole-PR manifest and review-thread index
  |     |-- run specialist reviewer agents as one review team
  |     |-- synthesize a review board
  |
  |-- Skill: present review board and interact with user
  |
  |-- Skill: draft selected comments
  |
  |-- Skill: preview, edit, and confirm
  |
  |-- GitHub MCP writes: post approved review
```

The Workflow returns candidate review material. It does not post comments and it
does not ask the user questions.

## Design Constraints

- GitHub MCP remains the source of truth for PR metadata, review threads,
  authenticated user identity, and all posting operations.
- PR diff data uses source adapters:
  - prefer local git when the checkout is verified to match the PR head
  - fall back to GitHub MCP `get_files` when local git is unavailable
  - parse persisted MCP result files only through a committed deterministic
    utility
- The analysis workflow is read-only.
- GitHub write tools are used only after final user approval.
- No ad-hoc generated Python, shell, `gh`, or `jq` parsing for GitHub data.
  Any parsing helper must be committed, deterministic, read-only, and schema
  validated.
- Large PRs must produce a complete manifest and honest scope summary.
- Large PR manifest collection must not require loading complete patch bodies
  into model context.
- Focused patch reads must be bounded and must report truncation when capped.
- Workflow output must record manifest source, patch source, fallback reason,
  recovery attempts, and collected-file counts.
- Existing review comments and bot comments must shape recommendations.
- Specialist agents must preserve evidence-rich reasoning.
- Comprehensive team review is the primary product surface.
- Standalone specialist agents are not an early implementation priority.
- Do not grant broad shell or local-file access to specialist agents. Local git
  and persisted-result parsing should run through narrow workflow/helper paths.
- Local-git-first diff collection requires non-MCP tool access for the
  collection/helper path: command execution, read access to the checkout, and a
  committed helper that runs bounded read-only git operations. This access must
  not be treated as general reviewer-agent capability.
- Workflow-spawned agents inherit the session tool allowlist. If helper command
  access must be allowlisted for the workflow, reviewer prompts and workflow
  structure must keep specialist agents from using shell or local file access.

## Proposed File Layout

Initial conservative layout:

```text
pr-review-toolkit/
  docs/
    PR_REVIEW_REQUIREMENTS.md
    WORKFLOW_REWRITE_CONTEXT.md
    WORKFLOW_REWRITE_PLAN.md
  README.md
  .claude-plugin/plugin.json

  skills/
    review-pr/
      SKILL.md
      review-pr.js
      tools/
        parse-github-files-result.js
```

Potential later layout after the capability spike:

```text
pr-review-toolkit/
  skills/
    review-pr/
      SKILL.md
      review-pr.js
      prompts/
        collectors.md
        reviewers.md
        synthesizer.md
        local-diff.md
      schemas/
        context.js
        findings.js
        review-board.js
      tools/
        local-diff-provider.js
        parse-github-files-result.js
```

Do not split prompts or schemas into imported files until the Workflow runtime
capability spike confirms that local file loading/imports work reliably.
Do not prioritize standalone plugin agents unless the comprehensive workflow
needs them as an implementation detail.

## Capability Spike

Before the full rewrite, create a small local Workflow probe or temporary branch
that answers:

- Can Workflow JS import sibling modules?
- Can Workflow JS read bundled prompt/schema files directly?
- Can Workflow scripts receive `${CLAUDE_SKILL_DIR}` or only explicit `args`?
- Which `agent()` options are reliable?
  - `label`
  - `schema`
  - `model`
  - `effort`
  - `phase`
  - tool restrictions, if any
- What does agent structured-output failure look like?
- Can workflow-spawned agents be constrained to GitHub MCP read tools from the
  workflow invocation, or must this be enforced by prompt plus skill tool
  allowlist?
- How large can MCP responses and Workflow variables get before truncation or
  instability becomes a practical issue?
- Can a committed helper be invoked without requiring generated heredoc scripts
  or broad shell access?
- What is the cheapest reliable path for local git manifest and focused patch
  extraction from a verified PR worktree?

The spike should avoid GitHub writes and should use no-op or read-only agents.

## Core Data Model

The analysis workflow should build a `PrContext` object.

```json
{
  "pr": {
    "owner": "org",
    "repo": "repo",
    "number": 123,
    "title": "PR title",
    "body": "PR body",
    "author": "login",
    "baseRef": "main",
    "headSha": "abc123",
    "changedFiles": 509,
    "additions": 37976,
    "deletions": 153784
  },
  "files": [
    {
      "path": "pkg/auth/session.go",
      "status": "modified",
      "additions": 42,
      "deletions": 12,
      "category": "source",
      "signals": ["error-handling", "public-api"],
      "patchAvailable": true,
      "page": 12,
      "perPage": 100,
      "threadCount": 2
    }
  ],
  "threads": [
    {
      "id": "thread-id",
      "path": "pkg/auth/session.go",
      "line": 88,
      "author": "reviewer",
      "body": "comment text",
      "resolved": false,
      "replies": []
    }
  ],
  "summary": {
    "scale": "large",
    "categories": {
      "source": 44,
      "tests": 13,
      "vendor": 420,
      "generated": 18
    },
    "riskAreas": ["auth", "error-handling", "tests"]
  },
  "sources": {
    "manifestSource": "local-git",
    "patchSource": "local-git",
    "diffRange": "origin/main...HEAD",
    "mergeBase": "def456",
    "fallbackReason": "",
    "recoveryAttempts": 0,
    "recoveredFileSlots": 0,
    "mcpOverflowCount": 0
  }
}
```

The exact schema can evolve, but downstream agents should receive a complete
manifest and enough review-thread context to reason about overlap.

### Source Adapters

The workflow should collect file metadata through explicit source adapters.
Every adapter returns the same compact manifest shape.

The local git adapter is intentionally preferred over GitHub MCP for diff data,
but it needs a separate execution path. It must be implemented as a narrow
collection/helper capability, not as broad shell or local filesystem access for
all reviewer agents. The helper path needs permission to run committed plugin
code and read-only git commands against the local checkout, while specialists
should consume only the resulting manifest and bounded patch excerpts.

1. **Local git adapter** is preferred when all eligibility checks pass:
   - the working directory is inside the expected repository
   - a remote corresponds to the PR base repository, or an accepted fork
     relationship is identified
   - `git rev-parse HEAD` exactly equals the PR `headSha`
   - the base ref or merge base can be resolved locally or fetched safely
   - the resulting file count matches PR metadata

   Use defensive, read-only git commands:

   ```text
   git rev-parse HEAD
   git remote -v
   git merge-base <base> HEAD
   git --no-pager diff --name-status -z --no-ext-diff --no-textconv <base>...HEAD
   git --no-pager diff --numstat -z --no-ext-diff --no-textconv <base>...HEAD
   git --no-pager diff --no-ext-diff --no-textconv <base>...HEAD -- <path>
   ```

   Parse `-z` output to handle spaces, tabs, renames, copies, binary files, and
   deletes.

2. **GitHub MCP adapter** is the fallback when local git is unavailable. For
   manifest collection, use `get_files` with `perPage=100` and treat persisted
   tool-result files as normal fallback input for the committed parser. Do not
   ask agents to inspect the saved files directly.

3. **Persisted MCP result parser** is a last-resort helper for oversized MCP
   outputs. It should accept only explicit tool-result paths, parse one-line JSON
   safely, strip patch bodies for manifest output, optionally return bounded
   single-file patch snippets, and schema-validate all output.

### Tool Access Model

Keep tool access split by responsibility:

- **Main skill conversation** uses `Workflow`, `AskUserQuestion`, GitHub MCP
  reads for final `headSha` rechecks, and GitHub MCP writes after explicit
  approval.
- **PR metadata and review-context collectors** use GitHub MCP read tools.
- **Local diff collection** uses a narrow helper execution path with read access
  to the checkout and committed plugin code. It may run read-only git commands
  such as `rev-parse`, `remote -v`, `merge-base`, and `diff`.
- **MCP fallback parsing** uses the committed parser helper against explicit
  persisted MCP result paths.
- **Specialist reviewers and synthesizer** should ideally have no tools. If the
  workflow runtime forces them to inherit a broader session allowlist, prompts
  must explicitly prohibit shell, local-file, and GitHub write usage, and the
  workflow should provide all required context up front.

The unresolved implementation choice is where helper execution happens:

- before launching the workflow, in the skill conversation
- inside a dedicated collection-only workflow agent
- through a plugin-supported helper/tool wrapper, if available

Do not proceed with Phase 3a until this execution model is proven.

`MAX_MCP_OUTPUT_TOKENS` is an operational escape hatch, not a design
requirement. A larger limit can make a run succeed, but it should not be
required for correctness.

## Candidate Finding Model

Specialist agents should return candidate findings, not final review comments.

```json
{
  "lens": "tests",
  "title": "Missing negative test for token refresh failure",
  "location": {
    "path": "pkg/auth/session.go",
    "line": 88
  },
  "confidence": "high",
  "postability": "likely",
  "claim": "The new refresh failure path is not covered by tests.",
  "evidence": "The diff adds fallback handling in session.go, but related tests only cover success.",
  "whyItMatters": "A regression could keep stale credentials active.",
  "suggestedFix": "Add a test where refresh returns an error and assert the session is invalidated.",
  "existingReviewOverlap": {
    "status": "none",
    "threadId": null,
    "rationale": ""
  },
  "draftComment": "Optional early draft, not final text."
}
```

The synthesizer may adjust classification, merge duplicates, or mark a finding
as covered, but it should preserve the specialist evidence.

## Review Board Model

The workflow should return a review board grouped by outcome:

```json
{
  "recommendedToPost": [],
  "possiblePlusOnes": [],
  "partialOverlaps": [],
  "discussionOnly": [],
  "alreadyCovered": [],
  "discarded": [],
  "positiveObservations": [],
  "actionPlan": {
    "critical": [],
    "important": [],
    "suggestions": [],
    "recommendedNextAction": "draft recommended"
  },
  "coverageSummary": {
    "scope": "Reviewed source, tests, comments, error-handling signals. Vendor files summarized.",
    "largePrNotes": []
  }
}
```

The skill should render this as a human-readable board before asking what to
draft. The board should retain the upstream toolkit's easy-to-scan action-plan
feel while adding existing-review awareness and interactive selection.

## Workflow Phases

### 1. Collect PR Context

Inputs:

- owner
- repo
- pull number

Actions:

- Fetch PR metadata.
- Determine the diff source.
- Fetch changed-file metadata through the selected source adapter.
- Fetch review comments and review threads with pagination.
- Fetch relevant review/check metadata if supported by the MCP tools.

Requirements:

- Use GitHub MCP read tools for PR metadata and review context.
- Prefer local git for changed-file metadata when the checkout is verified to
  match the PR head.
- Use GitHub MCP `get_files` as fallback. For large PRs, request `perPage=100`
  and parse persisted tool-result files with the committed parser.
- Collector agents and helpers should have narrow instructions.
- Each collector task should return compact structured JSON without patch text
  unless explicitly serving a bounded focused patch.
- The workflow script should merge page results in variables.
- Manifest collection must validate the merged file count against PR metadata.

### 2. Build Manifest And Indexes

Actions:

- Categorize files.
- Add signals such as:
  - test file
  - source file
  - docs/comments
  - error-handling patterns
  - type/interface/model changes
  - public API or config changes
  - generated/vendor/lockfile
- Group review comments by file.
- Identify obvious bot reviewers such as CodeRabbit where possible.
- Build a PR-level summary and scale assessment.
- Attach source metadata:
  - manifest source
  - patch source
  - diff range or page/perPage locators
  - fallback reason
  - recovery attempts and overflow count

### 3. Select Review Lenses

Default lenses:

- code reviewer always runs
- test analyzer when functional code changed
- silent-failure hunter when error-handling signals exist
- comment analyzer when docs/comments changed
- type-design analyzer when typed definitions or models changed

Selection should be liberal enough to avoid missing important cross-file issues,
but large PRs should still receive an honest scope summary.

### 4. Run Specialist Review Team

Each specialist receives:

- PR metadata
- complete file manifest
- PR-level summary
- review-thread summary
- source-specific instructions for bounded focused patch access

Specialists should:

- inspect the whole PR shape before focusing
- produce evidence-rich candidate findings
- identify possible existing-review overlap
- avoid final posting decisions
- contribute to one comprehensive review rather than acting as separate
  user-facing commands
- avoid broad local shell/file reads. Focused patches should be provided through
  the selected source adapter or committed helper.

### 5. Synthesize Review Board

The synthesizer should:

- merge duplicate findings
- preserve specialist evidence
- classify against existing review threads
- separate post candidates from discussion-only material
- identify possible plus-ones
- summarize already-covered findings
- preserve positive observations and strengths
- produce a concise action plan with critical, important, and suggestion groups
- produce an honest scope/coverage summary
- preserve source provenance and truncation notes in review metadata

### 6. Return To Skill

Return the review board to the main skill conversation. Do not draft final
comments or post.

## Skill Interaction Flow

After the workflow returns:

1. Present the review board.
2. Present a concise action plan and recommend what to draft.
3. Ask the user what to do.
4. Support natural commands:
   - `draft recommended`
   - `post 1,3`
   - `plus-one 2`
   - `skip 4`
   - `explain 3`
   - `challenge 1`
   - `show covered`
   - `cancel`
5. Respond to challenges with evidence and uncertainty.
6. Draft selected comments.
7. Preview exact comments and review body.
8. Allow edits/removals.
9. Ask for final posting approval.
10. Post via GitHub MCP write tools.

## Posting Flow

Use the existing GitHub MCP write pattern:

1. Create pending review.
2. Add approved line comments.
3. Include approved non-line findings in review body.
4. Submit with:
   - `REQUEST_CHANGES` for serious correctness or blocking concerns
   - `COMMENT` otherwise

No posting step should run from the analysis workflow.

## Migration Steps

### Phase 0: Requirements And Plan

- Keep `docs/PR_REVIEW_REQUIREMENTS.md`.
- Add this implementation plan.

### Phase 1: Capability Spike

- Add temporary probe workflow or local experimental branch.
- Answer the Workflow API and file-loading questions.
- Record conclusions in this plan or a short follow-up note.

### Phase 2: Replace Workflow Output Shape

- Modify the current workflow to return a review board instead of fully enriched
  final findings.
- Remove default per-finding verifier and resolved-thread verifier from the core
  analysis path.
- Keep existing embedded prompts initially to reduce moving parts.

### Phase 3: Centralize PR Collection

- Move GitHub PR metadata and review-thread collection into a dedicated
  collection phase.
- Stop requiring each specialist to refetch the same PR context.
- Add file categorization and PR scale summary.
- Split changed-file collection into source adapters:
  - `collectLocalGitManifest`
  - `collectMcpFileManifest`
  - `parsePersistedMcpFileResult`
- Record manifest source, patch source, fallback reason, and recovery metadata
  in `reviewMeta`.

### Phase 3a: Add Local Git Diff Provider

- Prove the helper execution model before implementation: skill pre-step,
  collection-only workflow agent, or plugin-supported helper wrapper.
- Ensure helper command access does not become general specialist-reviewer tool
  access.
- Detect whether the current checkout is an eligible PR worktree.
- Validate `HEAD` against PR `headSha`.
- Resolve or fetch the base ref safely.
- Build the manifest from `git diff --name-status -z` and
  `git diff --numstat -z`.
- Validate the local manifest count against GitHub PR metadata.
- Serve bounded focused patches from local git when `patchSource` is
  `local-git`.

### Phase 3b: Add MCP Fallback Parser

- Add a committed parser utility for persisted GitHub MCP `get_files` results.
- Use `perPage=100` for MCP manifest collection when local git is unavailable.
- Strip patch bodies for manifest output.
- Optionally provide bounded single-file patch extraction for focused review.
- Refuse arbitrary paths, validate schema, and report parser failures with a
  source-specific diagnostic.

### Phase 4: Restore Rich Specialist Output

- Replace the minimal finding schema with candidate findings.
- Preserve specialist-specific evidence and reasoning.
- Add postability recommendations.
- Make focused patch instructions conditional on `patchSource`.
- Mark findings that rely on truncated patch context.

### Phase 5: Add Review Board Synthesis

- Merge duplicates.
- Classify against existing comments.
- Produce recommended-to-post, plus-one, discussion-only, already-covered, and
  discarded groups.

### Phase 6: Rewrite Skill Interaction

- Simplify `SKILL.md` around:
  - launching analysis workflow
  - presenting board
  - interactive selection
  - drafting
  - final approval
  - posting

### Phase 7: Split Prompts And Agents

After the capability spike proves the best file-loading strategy:

- Move reviewer prompts out of the workflow script if practical.
- Consider plugin `agents/` only if they improve the comprehensive workflow
  implementation.
- Keep workflow orchestration separate from agent prompt content.
- Do not optimize standalone specialist UX before the team-review workflow is
  working well.

### Phase 8: Documentation And Validation

- Update `README.md`.
- Document required GitHub MCP tools and permission expectations.
- Document local git eligibility checks and the persisted-result parser.
- Validate on representative PRs.

## Validation Matrix

Test with:

- small PR with no existing review comments
- small PR with existing human review comments
- local PR worktree where `HEAD` matches PR `headSha`
- nonlocal PR where `HEAD` does not match PR `headSha`
- fork PR with a base repo remote and a fork head
- stale or missing base ref
- dirty worktree
- PR with CodeRabbit comments that already cover some findings
- PR with partial-overlap findings
- PR with only discussion-only recommendations
- PR with plus-one recommendations
- large PR with hundreds of files
- large PR dominated by vendor/generated changes
- large PR with single-file patches that exceed default MCP result limits
- PR with renames, copies, deletes, binary files, and paths containing spaces or
  tabs
- PR with missing test coverage
- PR with error-handling changes
- PR with comment/doc changes
- PR with type/model/interface changes
- PR with meaningful positive observations or strengths

For each test, verify:

- no generated parsing scripts are used
- GitHub metadata, review threads, identity, and writes come from MCP tools
- diff metadata comes from the expected source adapter
- local git/helper command access is limited to the collection path
- specialist reviewers do not use shell, local-file, or GitHub write tools
- source provenance appears in `reviewMeta`
- collected file count matches PR metadata, or the coverage summary explains
  exactly why it does not
- existing review context affects recommendations
- the review board is understandable
- the action plan is concise and easy to scan
- positive observations are preserved when useful
- the user can challenge findings
- drafts are editable
- posting requires explicit approval
- PR `headSha` is rechecked before posting; changed heads require rerun or
  explicit confirmation

## Risks

- Workflow runtime APIs may not support clean prompt/schema file imports.
- GitHub MCP result size and pagination behavior may constrain large-PR
  collection.
- Raising `MAX_MCP_OUTPUT_TOKENS` can make large MCP reads succeed but does not
  fix the underlying cost and scaling problem.
- Local git introduces a new trust boundary. Eligibility checks must prevent
  dirty, stale, or wrong-repository data from contaminating findings.
- Local diff line numbers must remain compatible with GitHub review comments.
- Too much structured schema may recreate the current rigidity.
- Too little structure may make synthesis unreliable.
- Specialist agents may still request too much raw context for very large PRs.
- Tool allowlisting may need user/session configuration outside the plugin.
- Giving specialist agents broad shell or local-file access would expand the
  prompt-injection surface. Prefer narrow helpers and source adapters.
- Because workflow-spawned agents inherit the session tool allowlist, adding
  helper command access for local git can accidentally expose that access to
  specialist agents unless the execution model isolates collection from review.
- Persisted MCP result parsing must not become arbitrary local file parsing.

## Initial Implementation Bias

Start conservative:

- one skill
- one bundled workflow JS file
- embedded prompts and schemas
- read-only GitHub MCP for PR metadata and review context
- verified local git for diff metadata when available
- review board output only
- no posting from workflow
- committed helper utilities only; no generated parsing scripts

Then split prompts, schemas, and reusable agents once the runtime behavior is
verified.

## Capability Spike Results

Tested 2026-06-22 against `openshift/hypershift#8704` (509 changed files,
+37,976/-153,784 lines, 33 review threads).

### Answered From Documentation

1. **Workflow JS cannot import sibling modules.** No filesystem or Node.js API
   access. Prompts and schemas must be embedded as string literals.
2. **Workflow JS cannot read bundled files.** Same constraint. Content must be
   passed via `args` or embedded directly.
3. **`${CLAUDE_SKILL_DIR}` is not available inside workflows.** The skill
   resolves it for `scriptPath`, but the workflow script only receives `args`.
4. **Reliable `agent()` options:** `label`, `phase`, `schema`, `model`,
   `effort`, `isolation`, `agentType`. No `tools` or `allowedTools` parameter
   exists. The current `review-pr.js` already uses all tested options
   successfully.
5. **Structured-output failure returns `null`.** Handle with
   `.filter(Boolean)`.
6. **No per-agent tool constraints from workflows.** Agents inherit the session
   tool allowlist. Read-only enforcement must use the skill's `allowed-tools`
   frontmatter and prompt instructions.

7. **MCP output limits are token-based and configurable.** Claude Code defaults
   to a 25,000-token MCP result limit and can be raised with
   `MAX_MCP_OUTPUT_TOKENS`. Oversized results are persisted to disk and replaced
   with a file reference.

### Answered Empirically

1. **`args` arrives as a JSON string, not a parsed object.** Despite the docs
   saying to pass actual JSON values, the runtime serializes them. Use
   `typeof args === 'string' ? JSON.parse(args) : (args || {})`.

2. **Structured-output response size is the bottleneck, not workflow variable
   capacity.** The file collector agent successfully fetched all 509 files
   across 6 API pages but could only fit 17 file entries in its structured
   output response. Thread collection (33 threads, 1 page) worked without
   truncation. Data that made it into workflow variables survived round-trip
   to downstream agents without corruption.

### Design Implications

The structured-output truncation finding shapes the collection phase design:

- **File collection must be paginated at the workflow level.** Use
  `pipeline()` or `parallel()` to spawn one collector agent per API page,
  each returning a small batch. The workflow script merges batches in
  variables.
- **Thread collection can use a single agent** for typical PRs (up to ~50
  threads). Very large review threads may need similar pagination.
- **Compact schemas help.** The file collector excluded raw patch content and
  still hit the limit at 509 entries. For very large PRs, consider returning
  only filename, status, and category per file, then fetching patches
  separately for high-signal files.
- **Workflow variable capacity is adequate.** The merged file manifest and
  thread index can be stored as workflow variables and passed to downstream
  agents without data loss.

### Follow-Up Test: Raised MCP Output Limit

Tested 2026-06-24 against `openshift/hypershift#8704` (510 changed files,
+38,054/-153,798 lines) with `MAX_MCP_OUTPUT_TOKENS` raised.

Results:

- The workflow completed successfully and produced a review board.
- `reviewMeta` reported `changedFileCount: 510` and `collectedFileCount: 510`.
- No actual `exceeds maximum allowed tokens` or `Output has been saved` runtime
  messages appeared in the workflow logs.
- The run still required 492 workflow agents, 1,179 tool calls, and 5,163,587
  tokens.
- The primary `perPage=10` file collection was still inefficient: 43 of 51
  primary pages were incomplete, requiring recovery of 430 file slots with
  `perPage=1`; 3 slots needed a second recovery attempt.

Design implication:

- Raising the MCP output limit is a useful operational workaround, but it should
  not be required for correctness.
- Without GitHub MCP changes, the scalable fallback path should use
  `perPage=100` plus a committed persisted-result parser for manifest
  collection, and bounded focused patch extraction for selected files.
- The preferred path remains local git for verified PR worktrees.

### Unchanged Assumptions

The conservative initial layout remains correct:

- one skill, one bundled workflow JS file
- embedded prompts and schemas
- read-only GitHub MCP for PR metadata and review context
- review board output only
- no posting from workflow
