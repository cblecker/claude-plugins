---
name: review-pr
description: >-
  Conduct a comprehensive PR review with scored findings and post
  as line-level review comments
disable-model-invocation: true
arguments: [pr-url]
argument-hint: <github-pr-url>
allowed-tools:
  - Workflow
  - Bash(git rev-parse *)
  - Bash(git fetch *)
  - Bash(git diff --name-status *)
  - mcp__plugin_github_github__pull_request_read
  - mcp__plugin_github_github__pull_request_review_write
  - mcp__plugin_github_github__add_comment_to_pending_review
  - AskUserQuestion
---

# PR Review: $pr-url

## Constraints

Do not generate ad-hoc scripts to process data. Use only the tools listed
in allowed-tools. Workflow return values and MCP results are structured
JSON — read them directly, do not shell out to parse or format them.

## Phase 1: Collect PR metadata

Parse `$pr-url` to extract owner, repo, and PR number from the GitHub URL
pattern `https://github.com/{owner}/{repo}/pull/{number}`.

### Step 1 — Get PR details and determine locality

1. Call `pull_request_read` with method `get` to get PR details. Extract:
   - `head.sha` (headSha)
   - `base.ref` (baseRef)
2. Run `git rev-parse HEAD` to get the local HEAD SHA. If it matches
   `head.sha`, set `isLocal` to true; otherwise false.
3. Run `git fetch origin <baseRef>` to ensure the merge-base is available
   locally for agents.

Note: `base.sha` from the API is the current tip of the base branch (it
updates as the base branch advances), not the merge-base. We pass
`baseRef` (the branch name) instead, and use three-dot syntax
(`origin/<baseRef>...HEAD`) which computes the merge-base implicitly —
matching what GitHub uses for the PR diff.

### Step 2 — Select review agents

1. Get the list of changed files with statuses:
   - If `isLocal` is true: run `git diff --name-status origin/<baseRef>...HEAD`
     (cheap — filenames only, no patches).
   - If `isLocal` is false: call `pull_request_read` with method `get_files`
     for the PR. Use only the filename and status from each entry.
2. `code-reviewer` always runs. For each optional agent, decide whether to
   include it based on the changed file list and the agent's role:

   | Agent | Role | Include when |
   |-------|------|-------------|
   | `silent-failure-hunter` | Audits error handling for silent failures, broad catches, swallowed errors | Changes touch code with error handling, try/catch, fallback logic, or result types |
   | `pr-test-analyzer` | Evaluates test coverage gaps for new/changed functionality | Changes include functional code that should have corresponding tests |
   | `comment-analyzer` | Verifies comment accuracy and flags misleading/stale documentation | Changes add or modify comments, docstrings, or documentation files |
   | `type-design-analyzer` | Reviews type invariants, encapsulation, and design in typed languages | Changes introduce or modify type definitions in typed languages (Go, TypeScript, Rust, Java, etc.) |

3. Use judgment — a PR that only renames a config key doesn't need a type
   design review even if it touches a `.go` file. A PR adding a new API
   endpoint with no tests warrants `pr-test-analyzer` even if no test files
   changed.

## Phase 2: Run review workflow

Invoke the Workflow tool with:

- `scriptPath`: `${CLAUDE_SKILL_DIR}/review-pr.js`
- `args`:
  - `owner`, `repo`, `pullNumber`, `headSha`, `baseRef`, `isLocal`
  - `agents`: array of selected agent names from Step 2

Wait for the workflow to complete. It returns a JSON object:

```json
{
  "findings": [
    {
      "file": "path/to/file.go",
      "line": 42,
      "severity": "critical | important | suggestion",
      "confidence": 85,
      "title": "Short title",
      "description": "Detailed explanation",
      "verificationStatus": "verified | unverified",
      "verificationRationale": "What was checked and confirmed",
      "status": "new | duplicate | partial_overlap",
      "matchedThreadId": "thread-id",
      "existingCoverage": "What the existing thread covers",
      "delta": "What our finding adds beyond the existing thread",
      "adjustedSeverity": "critical | important | suggestion",
      "adjustedConfidence": 90
    }
  ],
  "positiveObservations": ["Free-text observation"],
  "threadVerifications": [
    {
      "threadId": "thread-id",
      "file": "path/to/file.go",
      "line": 42,
      "originalConcern": "What the reviewer originally raised",
      "resolution": "fixed | pushed_back | unaddressed",
      "assessment": "Evaluation of the resolution",
      "isAdequate": true,
      "newIssueIntroduced": false
    }
  ],
  "reviewMeta": {
    "hasOwnResolvedThreads": true,
    "existingThreadCount": 8,
    "duplicateCount": 2,
    "partialOverlapCount": 1,
    "newCount": 5
  }
}
```

`line` may be absent for findings that apply to an entire file or PR.
Each finding has a `status` from the contextualization phase:

- `new` — no existing thread covers this issue
- `duplicate` — an existing thread fully covers the same concern
- `partial_overlap` — an existing thread touches the same area but our
  finding adds something; `delta` describes the addition and
  `adjustedSeverity`/`adjustedConfidence` rescore the incremental value

Each finding also has verification data from the adversarial verify phase:

- `verificationStatus`: `verified` or `unverified` (if the verifier was
  unavailable) — false positives are filtered before this output
- `verificationRationale`: what the verifier checked and confirmed

`threadVerifications` is non-empty when `hasOwnResolvedThreads` is true
(we left comments in a previous review that have since been resolved).
Each entry assesses whether the author addressed the concern.

## Phase 3: Present findings

The workflow returns classified findings and thread verifications.
Present them to the user in two steps: text output first, then a
selection prompt.

### Score resolution

For each finding, use the effective severity and confidence:

- If `adjustedSeverity` is present, use it; otherwise use `severity`
- If `adjustedConfidence` is present, use it; otherwise use `confidence`

### Step 1: Output findings as text

Output findings as plain text before any selection prompt. This step
is mandatory — do not skip or compress it into AskUserQuestion. Omit
any section that has no items. `[:{line}]` means include `:{line}`
only when line is present.

```
## PR Review: owner/repo#123

### Critical Issues

{for each finding where status = "new" and effective severity = critical}

1. `{file}[:{line}]` -- **{title}**
   {description}
   {if verificationStatus = "verified"}_Verified: {verificationRationale}_{end if}

### Important Issues

{for each finding where status = "new" and effective severity = important}

2. `{file}[:{line}]` -- **{title}**
   {description}
   {if verificationStatus = "verified"}_Verified: {verificationRationale}_{end if}

### Suggestions

{for each finding where status = "new" and effective severity = suggestion}

3. `{file}[:{line}]` -- **{title}**
   {description}
   {if verificationStatus = "verified"}_Verified: {verificationRationale}_{end if}

### Partial Overlaps

{for each finding where status = "partial_overlap"}

4. `{file}[:{line}]` -- **{title}**
   Extends existing review comment: {existingCoverage}.
   New insight: {delta}.
   {if verificationStatus = "verified"}_Verified: {verificationRationale}_{end if}

### Strengths

{for each positiveObservation}

- {observation}

### Previous Review Status

{for each threadVerification, only if threadVerifications is non-empty}

{icon} `{file}:{line}` -- {originalConcern}
   {assessment}

Icons:
  fixed + adequate:         Resolved
  fixed + inadequate:       Fix incomplete
  fixed + newIssue:         Fix introduced new issue: {newIssueDescription}
  pushed_back + adequate:   Author disagrees -- reasoning valid
  pushed_back + inadequate: Author disagrees -- {assessment}
  unaddressed:              Still unresolved
```

Key formatting rules:

- **No `[severity/confidence]` tags** — severity is conveyed by section
  header; confidence is implicit (low-confidence findings were filtered
  during analysis; false positives were removed by verification)
- **Verification line in italics** only for verified findings — omit
  entirely when `verificationStatus` is `unverified`
- **Only actionable findings are numbered** — Strengths and Previous
  Review Status are informational only
- **Duplicates omitted** — if any, add a one-line note: "N findings
  omitted as duplicates of existing review threads"
- **Partial overlaps** shown with existing coverage context and the new
  insight delta

### Step 2: Recommendation

After presenting the findings, analyze each one and recommend which to
include in the posted review. For each numbered finding, output a
one-line recommendation:

```
## Recommendations

1. **Include** -- nil pointer panic is a real crash risk in the error path
2. **Include** -- context cancellation gaps cause resource waste under load
3. **Skip** -- sync.Pool is a performance optimization, not a correctness
   issue; low value as a review comment on this PR
4. **Include** -- the existing thread missed the race condition angle
```

Consider these factors when making recommendations:

- **Severity and verification status** — verified critical/important
  findings are strong includes; overstated suggestions are candidates
  to skip
- **Signal-to-noise ratio** — a review with 3 strong findings is more
  useful than one with 10 of mixed quality; fewer, higher-impact
  comments make a better review
- **PR context** — a suggestion that's valid but tangential to the PR's
  purpose is noise; a finding central to what the PR is doing is signal
- **Actionability** — include findings the author can act on; skip
  findings that are observations without a clear next step

### Step 3: Selection prompt

Number findings sequentially across all actionable sections (new and
partial overlaps) so each has a unique number. After the recommendations,
ask via AskUserQuestion:

> "Which findings should I include in the review? Enter numbers
> (e.g. 1,3,5), 'all', 'none', or 'recommended' to accept my
> recommendations above."

Free-text response, not option buttons.

## Phase 4: Draft and preview comments

After the user selects findings, draft and preview the exact GitHub
comments before posting.

### Step 1: Draft each comment

For each approved finding, generate the exact text that will be posted
as a GitHub review comment. Comments should be:

- Written in first-person, natural voice (as if the user wrote them)
- 2-5 sentences: what the issue is, why it matters, suggested fix
- No boilerplate headers, severity tags, or "AI-generated" markers

### Step 2: Present draft comments for approval

Output all drafted comments grouped by file:

```
## Draft Review Comments

### path/to/file.go

**Line 42:**
> Comment text exactly as it will be posted.

**Line 128:**
> Comment text exactly as it will be posted.

---

Review event: **REQUEST_CHANGES** / **COMMENT**
(REQUEST_CHANGES if any critical findings selected, COMMENT otherwise)
```

Then ask via AskUserQuestion:

> "Ready to post these comments? Reply 'post', 'edit N' to modify a
> specific comment, or 'cancel'."

Free-text response, not option buttons.

### Step 3: Handle edits

If the user replies "edit N", show the current text of comment N and
let them provide a replacement. Re-present the updated comment set and
repeat the approval prompt. Loop until the user replies 'post' or
'cancel'.

## Phase 5: Post review

1. Create a pending review: `pull_request_review_write` with method `create`
2. For each approved finding with a file and line number:
   - Call `add_comment_to_pending_review` with the file, line, and the
     drafted comment text from Phase 4
   - Use `subjectType: "LINE"` and `side: "RIGHT"`
3. Write the review body as a brief summary of the review. Include any approved
   findings that lack a file or line number as inline items in the body.
4. Submit: `pull_request_review_write` with method `submit_pending`
   - Event: `REQUEST_CHANGES` if any critical findings were approved
   - Event: `COMMENT` otherwise
