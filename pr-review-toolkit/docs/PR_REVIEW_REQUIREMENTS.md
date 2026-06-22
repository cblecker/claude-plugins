# PR Review Toolkit Requirements And Principles

This document captures the enduring requirements and design principles for
`pr-review-toolkit`. It describes what the review experience should provide,
independent of any particular implementation.

## Purpose

The toolkit should help a human reviewer perform a high-quality, interactive
co-review of a pull request.

It should combine specialist model analysis with human judgment. The system may
find candidate issues, summarize tradeoffs, identify existing coverage, and draft
review comments, but the human reviewer remains responsible for deciding what is
posted.

The primary product surface is a comprehensive team review. Specialist reviewers
should usually work together behind the main review workflow rather than being
optimized first as separate user-facing commands.

## Core Principles

### Human-Centered Review

- Treat review as a collaboration with the user, not as an automated comment
  factory.
- Preserve the user's authority over what is posted.
- Make uncertainty visible instead of hiding it behind rigid classifications.
- Support disagreement, challenge, and refinement of findings.
- Separate analytical findings from final review comments.

### Whole-PR Awareness

- Reviewers need access to the shape of the entire pull request.
- Avoid reviewing tiny isolated diff packets without broader PR context.
- Every specialist review should understand:
  - what the PR is trying to change
  - the complete changed-file manifest
  - existing review comments and threads
  - high-signal and low-signal areas of the diff
  - how changed files relate to one another
- Large or low-signal sections may be deprioritized, summarized, or expanded on
  demand, but they should not be hidden from the review context entirely.

### Specialist Reasoning

- Different review lenses should be represented by focused specialists.
- Specialist reviewers should behave like members of a review team contributing
  distinct perspectives to one comprehensive review.
- Specialists should reason from evidence and explain why an issue matters.
- Specialist output should preserve domain-specific nuance rather than forcing
  every result into an overly narrow generic schema.
- Specialist findings are candidates for human review, not final posting
  decisions.

### Context-Aware Recommendations

- The toolkit should account for existing PR context before recommending new
  comments.
- It should avoid repeating findings that are already fully covered by human
  reviewers, CodeRabbit, or other review tools.
- It should still surface useful relationships to existing review threads:
  - already covered
  - partial overlap
  - possible plus-one
  - worth discussing, but not posting
- Covered findings should not disappear silently when that context would help
  the user understand the review state.

### Safe And Predictable Tooling

- GitHub data should be fetched through GitHub MCP tools.
- GitHub read operations and GitHub write operations should be clearly separated.
- Posting should only happen after explicit user approval.
- The toolkit should avoid ad-hoc, model-generated parsing scripts for GitHub
  data.
- Any reusable helper scripts should be bundled with the plugin, reviewable, and
  limited to safe deterministic behavior.
- The user should not have to approve a long sequence of surprising tool calls
  during normal operation.

### Scalable Review

- The toolkit should handle small, medium, and large PRs.
- Large PR handling should be explicit and honest about scope.
- For very large PRs, the toolkit should build a complete manifest and focus
  detailed analysis where it has the highest review value.
- The user should be able to expand review scope when needed.
- The system should minimize duplicate data fetching and repeated parsing.

## Review Lenses

The toolkit should support a comprehensive team review across multiple lenses,
including:

- general code correctness and maintainability
- test coverage and regression protection
- silent failures and error handling
- comment and documentation accuracy
- type design and invariant quality

Additional lenses may be added when they provide distinct review value.

Each lens should be scoped to the kind of evidence it is best suited to analyze.
For example, a test reviewer should focus on behavioral coverage and meaningful
regression protection, while an error-handling reviewer should focus on
swallowed errors, broad catches, hidden fallback behavior, and user-visible
failure modes.

Standalone specialist use may be useful later, but the main experience should
prioritize comprehensive reviews where applicable specialists collaborate toward
one review board.

## Pull Request Context Requirements

The toolkit should collect or make available:

- PR title, body, author, base branch, head SHA, and review state
- complete changed-file manifest
- file status, additions, deletions, and patch availability
- changed-file categories, such as:
  - source
  - tests
  - docs
  - config
  - CI
  - generated
  - vendor
  - lockfiles
  - binary or patch-unavailable files
- existing review comments and threads
- thread authors and resolved state where available
- bot comments and automated review-tool comments where available

This context should be organized so reviewers can reason about the whole PR
without eagerly loading every raw patch into every prompt.

## Large PR Requirements

For large PRs, the toolkit should:

- build a complete changed-file manifest
- categorize all files, including files that are likely low-signal
- expose the scale of the PR clearly
- avoid pretending it fully reviewed areas it only summarized
- prioritize detailed review of high-signal areas
- support follow-up expansion into specific files, categories, or review lenses
- keep vendor/generated/lockfile changes visible as context, even when
  deprioritized

Large PR review should feel like structured triage plus targeted deep review,
not a failed attempt to stuff the entire PR into one model context.

## Finding Requirements

Candidate findings should include enough information for the user to evaluate
them.

A useful finding should include:

- review lens
- title
- file and line when available
- confidence or uncertainty
- claim
- evidence from the PR context
- why it matters
- suggested fix or next step
- relationship to existing review comments
- recommendation about whether to post

The toolkit should also preserve useful non-finding observations, including:

- positive observations
- strengths in the PR
- areas that look well-covered by tests or review
- notes that help the user understand the PR but should not become comments

Findings should be classifiable as:

- recommended to post
- possible plus-one
- partial overlap
- discussion-only
- already covered
- weak or discard

Findings should not be treated as authoritative just because they were produced
by a specialist. The user should be able to ask for evidence, challenge the
claim, or decide that a true finding is not worth posting.

## Existing Review Context Requirements

The toolkit should compare candidate findings against existing review activity.

- Fully covered findings should not be recommended as new comments.
- Partial overlaps should identify what the existing thread covers and what the
  candidate adds.
- Possible plus-ones should identify the thread being endorsed and the reason an
  endorsement may be useful.
- Discussion-only findings should be retained when they are valuable to the
  human reviewer but not appropriate as PR comments.
- Existing review context should influence recommendations, not erase useful
  information.

## Interactive Review Requirements

The toolkit should present a review board before drafting or posting comments.

The review board should group findings by outcome:

- recommended to post
- possible plus-ones
- partial overlaps
- worth discussing, not posting
- already covered
- weak or discarded findings, optionally summarized

The review board should also include a concise action-plan view that is easy to
scan:

- highest-priority issues first
- important non-blocking issues next
- optional suggestions clearly separated
- strengths or positive observations
- a recommended next action

The user should be able to respond naturally with actions such as:

- post selected findings
- draft recommended findings
- skip selected findings
- add a plus-one
- ask for more explanation
- challenge a finding
- inspect already-covered findings
- cancel the review

The assistant should respond to challenges with evidence, uncertainty, and
tradeoffs. It should not treat the analysis output as final truth.

## Drafting Requirements

Drafting should happen after the user selects what is worth including.

Draft comments should:

- sound like the user wrote them
- be concise and actionable
- avoid boilerplate, severity labels, and AI markers
- include enough context for the PR author to act
- avoid duplicating comments already covered elsewhere
- distinguish between blocking concerns and optional suggestions

The toolkit should preview:

- each line comment
- any review-body text
- the proposed review event, such as `COMMENT` or `REQUEST_CHANGES`

The user should be able to edit or remove drafted comments before posting.

## Posting Requirements

- Posting must require explicit user approval.
- GitHub write operations should be limited to the approved posting step.
- Approved line findings should be posted as line comments where valid line
  locations are available.
- Approved findings without valid line locations should be included only in the
  review body.
- The review event should reflect the selected findings:
  - use `REQUEST_CHANGES` only for serious correctness or blocking concerns
  - use `COMMENT` for non-blocking feedback

## Safety Requirements

- Analysis should avoid tools capable of modifying the repository unless the
  user explicitly requests a different workflow.
- GitHub data access should use GitHub MCP read tools.
- GitHub posting should use GitHub MCP write tools.
- Generated parsing scripts should not be used for GitHub data.
- Reusable helper scripts, if used, should be bundled with the plugin and
  reviewable.
- Tool usage should be predictable enough that users can trust the workflow.

## Efficiency Requirements

- Avoid repeated fetching of the same GitHub data when collected data can be
  reused.
- Avoid requiring each specialist to independently reconstruct the same PR
  context.
- Keep large intermediate data out of the main conversation where possible.
- Prefer structured data and reusable context artifacts over repeated free-form
  model parsing.

## Success Criteria

The toolkit is successful when:

- the user can review a PR from multiple useful angles
- large PRs produce honest, useful review boards instead of overwhelming the
  model
- existing human and bot review comments shape the recommendations
- the user can challenge and refine findings before comments are drafted
- drafted comments are previewed and editable before posting
- no GitHub write action happens without explicit approval
- the experience feels like a collaborative review process
