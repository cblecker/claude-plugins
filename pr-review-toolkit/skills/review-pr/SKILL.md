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

`threadVerifications` is non-empty when `hasOwnResolvedThreads` is true
(we left comments in a previous review that have since been resolved).
Each entry assesses whether the author addressed the concern.

## Phase 3: Present findings

The workflow returns classified findings and thread verifications.
Present them to the user via AskUserQuestion using the template below.

### Score resolution

For each finding, use the effective severity and confidence:

- If `adjustedSeverity` is present, use it; otherwise use `severity`
- If `adjustedConfidence` is present, use it; otherwise use `confidence`

### Presentation template

Build the AskUserQuestion body using this structure. Omit any section
that has no items. `[:{line}]` means include `:{line}` only when line
is present; omit the colon and line number for file-level findings.

```
## Review Summary

{reviewMeta.existingThreadCount} existing thread(s) on this PR.
{reviewMeta.newCount} new finding(s), {reviewMeta.partialOverlapCount}
partial overlap(s), {reviewMeta.duplicateCount} duplicate(s).

---

## New Findings

{for each finding where status = "new", grouped by effective severity}

### Critical

1. **[critical/{effectiveConfidence}]** `{file}[:{line}]` — {title}
   {description}

### Important

2. **[important/{effectiveConfidence}]** `{file}[:{line}]` — {title}
   {description}

### Suggestions

3. **[suggestion/{effectiveConfidence}]** `{file}[:{line}]` — {title}
   {description}

---

## Partial Overlaps

{for each finding where status = "partial_overlap"}

4. **[{effectiveSeverity}/{effectiveConfidence}]** `{file}[:{line}]`
   — {title}
   Existing comment covers: {existingCoverage}
   Our addition: {delta}

---

## Duplicates (will not post unless selected)

{for each finding where status = "duplicate"}

5. `{file}[:{line}]` — {existingCoverage}
   Independently flagged the same issue.

---

## Previous Review Status

{for each threadVerification, only if threadVerifications is non-empty}

- {icon} `{file}:{line}` — {originalConcern}
  {assessment}

Icons:
  fixed + adequate:        ✅ Resolved
  fixed + inadequate:      ⚠️ Fix incomplete
  fixed + newIssue:        🔴 Fix introduced new issue: {newIssueDescription}
  pushed_back + adequate:  ✅ Author disagrees — reasoning valid
  pushed_back + inadequate:⚠️ Author disagrees — {assessment}
  unaddressed:             ❌ Still unresolved

---

## Positive Observations

{for each positiveObservation}

- {observation}
```

### Final prompt

Number findings sequentially across all sections (new, partial overlaps,
duplicates) so each has a unique number. After the template, ask:
"Which findings should I include in the review? Select by number
(e.g. 1,3,5), or reply 'all new' / 'all new + overlaps' / 'none'."

## Phase 4: Post review (after user approval)

1. Create a pending review: `pull_request_review_write` with method `create`
2. For each approved finding with a file and line number:
   - Call `add_comment_to_pending_review` with the file, line, and a
     natural-language comment written as if by the user
   - Use `subjectType: "LINE"` and `side: "RIGHT"`
3. Write the review body as a brief summary of the review. Include any approved
   findings that lack a file or line number as inline items in the body.
4. Submit: `pull_request_review_write` with method `submit_pending`
   - Event: `REQUEST_CHANGES` if any critical findings were approved
   - Event: `COMMENT` otherwise
