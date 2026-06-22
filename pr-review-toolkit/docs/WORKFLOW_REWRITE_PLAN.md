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
  |     |-- collect PR metadata, files, and review context via GitHub MCP reads
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

- GitHub data collection uses GitHub MCP tools only.
- The analysis workflow is read-only.
- GitHub write tools are used only after final user approval.
- No ad-hoc generated Python, shell, `gh`, or `jq` parsing for GitHub data.
- Large PRs must produce a complete manifest and honest scope summary.
- Existing review comments and bot comments must shape recommendations.
- Specialist agents must preserve evidence-rich reasoning.
- Comprehensive team review is the primary product surface.
- Standalone specialist agents are not an early implementation priority.
- The first implementation should stay close to the currently working Workflow
  pattern until runtime capabilities are proven.

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
      schemas/
        context.js
        findings.js
        review-board.js
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
      "patchExcerpt": "...",
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
  }
}
```

The exact schema can evolve, but downstream agents should receive a complete
manifest and enough review-thread context to reason about overlap.

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
- Fetch changed files with pagination.
- Fetch review comments and review threads with pagination.
- Fetch relevant review/check metadata if supported by the MCP tools.

Requirements:

- Use GitHub MCP read tools only.
- Collector agents should have narrow instructions.
- Each collector task should return compact structured JSON.
- The workflow script should merge page results in variables.

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
- relevant patch excerpts or focused context

Specialists should:

- inspect the whole PR shape before focusing
- produce evidence-rich candidate findings
- identify possible existing-review overlap
- avoid final posting decisions
- contribute to one comprehensive review rather than acting as separate
  user-facing commands

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

- Move GitHub PR metadata, file list, and review-thread collection into a
  dedicated collection phase.
- Stop requiring each specialist to refetch the same PR context.
- Add file categorization and PR scale summary.

### Phase 4: Restore Rich Specialist Output

- Replace the minimal finding schema with candidate findings.
- Preserve specialist-specific evidence and reasoning.
- Add postability recommendations.

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
- Validate on representative PRs.

## Validation Matrix

Test with:

- small PR with no existing review comments
- small PR with existing human review comments
- PR with CodeRabbit comments that already cover some findings
- PR with partial-overlap findings
- PR with only discussion-only recommendations
- PR with plus-one recommendations
- large PR with hundreds of files
- large PR dominated by vendor/generated changes
- PR with missing test coverage
- PR with error-handling changes
- PR with comment/doc changes
- PR with type/model/interface changes
- PR with meaningful positive observations or strengths

For each test, verify:

- no generated parsing scripts are used
- GitHub data comes from MCP tools
- existing review context affects recommendations
- the review board is understandable
- the action plan is concise and easy to scan
- positive observations are preserved when useful
- the user can challenge findings
- drafts are editable
- posting requires explicit approval

## Risks

- Workflow runtime APIs may not support clean prompt/schema file imports.
- GitHub MCP result size and pagination behavior may constrain large-PR
  collection.
- Too much structured schema may recreate the current rigidity.
- Too little structure may make synthesis unreliable.
- Specialist agents may still request too much raw context for very large PRs.
- Tool allowlisting may need user/session configuration outside the plugin.

## Initial Implementation Bias

Start conservative:

- one skill
- one bundled workflow JS file
- embedded prompts and schemas
- read-only GitHub MCP analysis
- review board output only
- no posting from workflow

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

### Answered Empirically

7. **`args` arrives as a JSON string, not a parsed object.** Despite the docs
   saying to pass actual JSON values, the runtime serializes them. Use
   `typeof args === 'string' ? JSON.parse(args) : (args || {})`.

8. **Structured-output response size is the bottleneck, not workflow variable
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

### Unchanged Assumptions

The conservative initial layout remains correct:

- one skill, one bundled workflow JS file
- embedded prompts and schemas
- read-only GitHub MCP analysis
- review board output only
- no posting from workflow
