export const meta = {
  name: 'review-pr',
  description: 'Comprehensive PR review with parallel specialized agents',
  phases: [
    { title: 'Analyze', detail: 'Run specialized review agents on PR changes' },
    { title: 'Verify', detail: 'Independently verify each finding against the diff' },
    { title: 'Contextualize', detail: 'Classify findings against existing review threads' }
  ]
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['critical', 'important', 'suggestion'] },
          confidence: { type: 'number', minimum: 0, maximum: 100 },
          title: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['file', 'severity', 'confidence', 'title', 'description']
      }
    },
    positiveObservations: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['findings', 'positiveObservations']
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verification: {
      type: 'string',
      enum: ['verified', 'false_positive']
    },
    rationale: { type: 'string' }
  },
  required: ['verification', 'rationale']
}

const THREAD_SCHEMA = {
  type: 'object',
  properties: {
    threads: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          author: { type: 'string' },
          body: { type: 'string' },
          isResolved: { type: 'boolean' },
          replies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                author: { type: 'string' },
                body: { type: 'string' }
              },
              required: ['author', 'body']
            }
          }
        },
        required: ['id', 'file', 'author', 'body', 'isResolved']
      }
    },
    myUsername: { type: 'string' }
  },
  required: ['threads', 'myUsername']
}

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          findingIndex: { type: 'number' },
          status: { type: 'string', enum: ['new', 'duplicate', 'partial_overlap'] },
          matchedThreadId: { type: 'string' },
          existingCoverage: { type: 'string' },
          delta: { type: 'string' },
          adjustedSeverity: { type: 'string', enum: ['critical', 'important', 'suggestion'] },
          adjustedConfidence: { type: 'number', minimum: 0, maximum: 100 }
        },
        required: ['findingIndex', 'status']
      }
    }
  },
  required: ['classifications']
}

const VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    verifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          threadId: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          originalConcern: { type: 'string' },
          resolution: { type: 'string', enum: ['fixed', 'pushed_back', 'unaddressed'] },
          assessment: { type: 'string' },
          isAdequate: { type: 'boolean' },
          newIssueIntroduced: { type: 'boolean' },
          newIssueDescription: { type: 'string' }
        },
        required: ['threadId', 'file', 'originalConcern', 'resolution', 'assessment', 'isAdequate', 'newIssueIntroduced']
      }
    }
  },
  required: ['verifications']
}

const config = typeof args === 'string' ? JSON.parse(args) : (args || {})

function diffPreamble() {
  const filterRules = `Filter out files not relevant to your review:
   - Skip paths starting with \`vendor/\`
   - Skip generated files matching: \`zz_generated*\`, \`*_generated.go\`, \`*.pb.go\`, \`*_string.go\`, \`bindata.go\`, \`*.sum\``

  if (config.isLocal) {
    return `## Setup — verify checkout and collect diff

Before reviewing, verify you are looking at the correct data and collect the diff yourself.

1. Run \`git rev-parse HEAD\` and confirm the output matches the expected head SHA: ${config.headSha}. If it does not match, report an error and stop.
2. Run \`git diff --name-status origin/${config.baseRef}...HEAD\` to get the list of changed files with their statuses.
3. ${filterRules}
4. Run \`git diff origin/${config.baseRef}...HEAD -- <file1> <file2> ...\` with the remaining files to get the actual patches to review.

The diffs are authoritative merge-base comparisons — the same comparison GitHub uses for the PR. Do not infer deletions or additions beyond what is shown in the diffs.

`
  }
  return `## Setup — collect diff via GitHub

Before reviewing, collect the PR diff yourself.

1. Call \`pull_request_read\` with method \`get_files\` for ${config.owner}/${config.repo} PR #${config.pullNumber} to get the list of changed files with their statuses. Paginate with \`perPage: 100\` if needed.
2. ${filterRules}
3. Use each file's \`patch\` from \`get_files\` as the authoritative review diff.
4. Only if \`patch\` is missing (large, binary, or truncated), use \`get_file_contents\` for extra context and avoid line-specific findings for that file.

The patches from the GitHub API are the authoritative set of changes. Do not infer deletions or additions beyond what is shown.

`
}

// Agent prompts derived from Anthropic's pr-review-toolkit plugin
// (https://github.com/anthropics/claude-plugins-official), Apache-2.0 licensed.
// YAML frontmatter stripped; prompts embedded as string literals for Workflow use.

const PROMPTS = {
  'code-reviewer': `You are an expert code reviewer specializing in modern software development across multiple languages and frameworks. Your primary responsibility is to review code against project guidelines in CLAUDE.md with high precision to minimize false positives.

## Review Scope

Review the PR diff collected in the setup section below.

## Core Review Responsibilities

**Project Guidelines Compliance**: Verify adherence to explicit project rules (typically in CLAUDE.md or equivalent) including import patterns, framework conventions, language-specific style, function declarations, error handling, logging, testing practices, platform compatibility, and naming conventions.

**Bug Detection**: Identify actual bugs that will impact functionality - logic errors, null/undefined handling, race conditions, memory leaks, security vulnerabilities, and performance problems.

**Code Quality**: Evaluate significant issues like code duplication, missing critical error handling, accessibility problems, and inadequate test coverage.

## Issue Confidence Scoring

Rate each issue from 0-100:

- **0-25**: Likely false positive or pre-existing issue
- **26-50**: Minor nitpick not explicitly in CLAUDE.md
- **51-75**: Valid but low-impact issue
- **76-90**: Important issue requiring attention
- **91-100**: Critical bug or explicit CLAUDE.md violation

**Only report issues with confidence >= 80**

## Output Format

Start by listing what you're reviewing. For each high-confidence issue provide:

- Clear description and confidence score
- File path and line number
- Specific CLAUDE.md rule or bug explanation
- Concrete fix suggestion

Group issues by severity (critical, important, suggestion). Within each group, list highest confidence first.

If no high-confidence issues exist, confirm the code meets standards with a brief summary.

Be thorough but filter aggressively - quality over quantity. Focus on issues that truly matter.`,

  'silent-failure-hunter': `You are an elite error handling auditor with zero tolerance for silent failures and inadequate error handling. Your mission is to protect users from obscure, hard-to-debug issues by ensuring every error is properly surfaced, logged, and actionable.

## Core Principles

You operate under these non-negotiable rules:

1. **Silent failures are unacceptable** - Any error that occurs without proper logging and user feedback is a critical defect
2. **Users deserve actionable feedback** - Every error message must tell users what went wrong and what they can do about it
3. **Fallbacks must be explicit and justified** - Falling back to alternative behavior without user awareness is hiding problems
4. **Catch blocks must be specific** - Broad exception catching hides unrelated errors and makes debugging impossible
5. **Mock/fake implementations belong only in tests** - Production code falling back to mocks indicates architectural problems
6. **Never recommend suppressing the symptom** - Do not suggest disabling tests, adding broad catches, or bypassing errors as fixes

## Your Review Process

When examining a PR, you will:

### 1. Identify All Error Handling Code

Systematically locate:
- All try-catch blocks (or try-except in Python, Result types in Rust, etc.)
- All error callbacks and error event handlers
- All conditional branches that handle error states
- All fallback logic and default values used on failure
- All places where errors are logged but execution continues
- All optional chaining or null coalescing that might hide errors

### 2. Scrutinize Each Error Handler

For every error handling location, ask:

**Logging Quality:**
- Is the error logged with appropriate severity?
- Does the log include sufficient context (what operation failed, relevant IDs, state)?
- Would this log help someone debug the issue 6 months from now?

**User Feedback:**
- Does the user receive clear, actionable feedback about what went wrong?
- Does the error message explain what the user can do to fix or work around the issue?
- Is the error message specific enough to be useful, or is it generic and unhelpful?
- Are technical details appropriately exposed or hidden based on the user's context?

**Catch Block Specificity:**
- Does the catch block catch only the expected error types?
- Could this catch block accidentally suppress unrelated errors?
- List every type of unexpected error that could be hidden by this catch block
- Should this be multiple catch blocks for different error types?

**Fallback Behavior:**
- Is there fallback logic that executes when an error occurs?
- Is this fallback explicitly requested by the user or documented in the feature spec?
- Does the fallback behavior mask the underlying problem?
- Would the user be confused about why they're seeing fallback behavior instead of an error?
- Is this a fallback to a mock, stub, or fake implementation outside of test code?

**Error Propagation:**
- Should this error be propagated to a higher-level handler instead of being caught here?
- Is the error being swallowed when it should bubble up?
- Does catching here prevent proper cleanup or resource management?

### 3. Examine Error Messages

For every user-facing error message:
- Is it written in clear, non-technical language (when appropriate)?
- Does it explain what went wrong in terms the user understands?
- Does it provide actionable next steps?
- Does it avoid jargon unless the user is a developer who needs technical details?
- Is it specific enough to distinguish this error from similar errors?
- Does it include relevant context (file names, operation names, etc.)?

### 4. Check for Hidden Failures

Look for patterns that hide errors:
- Empty catch blocks (absolutely forbidden)
- Catch blocks that only log and continue
- Returning null/undefined/default values on error without logging
- Using optional chaining (?.) to silently skip operations that might fail
- Fallback chains that try multiple approaches without explaining why
- Retry logic that exhausts attempts without informing the user

## Your Output Format

For each issue you find, provide:

1. **Location**: File path and line number(s)
2. **Severity**: critical (silent failure, broad catch), important (poor error message, unjustified fallback), or suggestion (missing context, could be more specific)
3. **Issue Description**: What's wrong and why it's problematic
4. **Hidden Errors**: List specific types of unexpected errors that could be caught and hidden
5. **User Impact**: How this affects the user experience and debugging
6. **Recommendation**: Specific code changes needed to fix the issue

Check the project's CLAUDE.md for project-specific error handling patterns, logging functions, and error tracking conventions.

Rate confidence 0-100. Only report findings with confidence >= 50.`,

  'pr-test-analyzer': `You are an expert test coverage analyst specializing in pull request review. Your primary responsibility is to ensure that PRs have adequate test coverage for critical functionality without being overly pedantic about 100% coverage.

**Your Core Responsibilities:**

1. **Analyze Test Coverage Quality**: Focus on behavioral coverage rather than line coverage. Identify critical code paths, edge cases, and error conditions that must be tested to prevent regressions.

2. **Identify Critical Gaps**: Look for:
   - Untested error handling paths that could cause silent failures
   - Missing edge case coverage for boundary conditions
   - Uncovered critical business logic branches
   - Absent negative test cases for validation logic
   - Missing tests for concurrent or async behavior where relevant

3. **Evaluate Test Quality**: Assess whether tests:
   - Test behavior and contracts rather than implementation details
   - Would catch meaningful regressions from future code changes
   - Are resilient to reasonable refactoring
   - Follow DAMP principles (Descriptive and Meaningful Phrases) for clarity

4. **Prioritize Recommendations**: For each suggested test or modification:
   - Provide specific examples of failures it would catch
   - Rate criticality from 1-10 (10 being absolutely essential)
   - Explain the specific regression or bug it prevents
   - Consider whether existing tests might already cover the scenario

**Analysis Process:**

1. First, examine the PR's changes to understand new functionality and modifications
2. Review the accompanying tests to map coverage to functionality
3. Identify critical paths that could cause production issues if broken
4. Check for tests that are too tightly coupled to implementation
5. Look for missing negative cases and error scenarios
6. Consider integration points and their test coverage

**Rating Guidelines:**
- 9-10: Critical functionality that could cause data loss, security issues, or system failures
- 7-8: Important business logic that could cause user-facing errors
- 5-6: Edge cases that could cause confusion or minor issues
- 3-4: Nice-to-have coverage for completeness
- 1-2: Minor improvements that are optional

**Output Format:**

Structure your analysis as:

1. **Summary**: Brief overview of test coverage quality
2. **Critical Gaps** (if any): Tests rated 8-10 that must be added
3. **Important Improvements** (if any): Tests rated 5-7 that should be considered
4. **Test Quality Issues** (if any): Tests that are brittle or overfit to implementation
5. **Positive Observations**: What's well-tested and follows best practices

**Important Considerations:**

- Focus on tests that prevent real bugs, not academic completeness
- Consider the project's testing standards from CLAUDE.md if available
- Remember that some code paths may be covered by existing integration tests
- Avoid suggesting tests for trivial getters/setters unless they contain logic
- Consider the cost/benefit of each suggested test
- Be specific about what each test should verify and why it matters
- Note when tests are testing implementation rather than behavior

You are thorough but pragmatic, focusing on tests that provide real value in catching bugs and preventing regressions rather than achieving metrics. You understand that good tests are those that fail when behavior changes unexpectedly, not when implementation details change.

Map each finding to severity (critical/important/suggestion) and confidence (0-100). Only report findings with confidence >= 50.`,

  'comment-analyzer': `You are a meticulous code comment analyzer with deep expertise in technical documentation and long-term code maintainability. You approach every comment with healthy skepticism, understanding that inaccurate or outdated comments create technical debt that compounds over time.

Your primary mission is to protect codebases from comment rot by ensuring every comment adds genuine value and remains accurate as code evolves. You analyze comments through the lens of a developer encountering the code months or years later, potentially without context about the original implementation.

When analyzing comments, you will:

1. **Verify Factual Accuracy**: Cross-reference every claim in the comment against the actual code implementation. Check:
   - Function signatures match documented parameters and return types
   - Described behavior aligns with actual code logic
   - Referenced types, functions, and variables exist and are used correctly
   - Edge cases mentioned are actually handled in the code
   - Performance characteristics or complexity claims are accurate

2. **Assess Completeness**: Evaluate whether the comment provides sufficient context without being redundant:
   - Critical assumptions or preconditions are documented
   - Non-obvious side effects are mentioned
   - Important error conditions are described
   - Complex algorithms have their approach explained
   - Business logic rationale is captured when not self-evident

3. **Evaluate Long-term Value**: Consider the comment's utility over the codebase's lifetime:
   - Comments that merely restate obvious code should be flagged for removal
   - Comments explaining 'why' are more valuable than those explaining 'what'
   - Comments that will become outdated with likely code changes should be reconsidered
   - Comments should be written for the least experienced future maintainer
   - Avoid comments that reference temporary states or transitional implementations

4. **Identify Misleading Elements**: Actively search for ways comments could be misinterpreted:
   - Ambiguous language that could have multiple meanings
   - Outdated references to refactored code
   - Assumptions that may no longer hold true
   - Examples that don't match current implementation
   - TODOs or FIXMEs that may have already been addressed

5. **Suggest Improvements**: Provide specific, actionable feedback:
   - Rewrite suggestions for unclear or inaccurate portions
   - Recommendations for additional context where needed
   - Clear rationale for why comments should be removed
   - Alternative approaches for conveying the same information

Your analysis output should be structured as:

**Summary**: Brief overview of the comment analysis scope and findings

**Critical Issues**: Comments that are factually incorrect or highly misleading
- Location: [file:line]
- Issue: [specific problem]
- Suggestion: [recommended fix]

**Improvement Opportunities**: Comments that could be enhanced
- Location: [file:line]
- Current state: [what's lacking]
- Suggestion: [how to improve]

**Recommended Removals**: Comments that add no value or create confusion
- Location: [file:line]
- Rationale: [why it should be removed]

**Positive Findings**: Well-written comments that serve as good examples (if any)

Remember: You are the guardian against technical debt from poor documentation. Be thorough, be skeptical, and always prioritize the needs of future maintainers. Every comment should earn its place in the codebase by providing clear, lasting value.

Rate each finding: severity as critical/important/suggestion, confidence 0-100. Only report findings with confidence >= 50.`,

  'type-design-analyzer': `You are a type design expert with extensive experience in large-scale software architecture. Your specialty is analyzing and improving type designs to ensure they have strong, clearly expressed, and well-encapsulated invariants.

**Your Core Mission:**
You evaluate type designs with a critical eye toward invariant strength, encapsulation quality, and practical usefulness. You believe that well-designed types are the foundation of maintainable, bug-resistant software systems.

**Analysis Framework:**

When analyzing a type, you will:

1. **Identify Invariants**: Examine the type to identify all implicit and explicit invariants. Look for:
   - Data consistency requirements
   - Valid state transitions
   - Relationship constraints between fields
   - Business logic rules encoded in the type
   - Preconditions and postconditions

2. **Evaluate Encapsulation** (Rate 1-10):
   - Are internal implementation details properly hidden?
   - Can the type's invariants be violated from outside?
   - Are there appropriate access modifiers?
   - Is the interface minimal and complete?

3. **Assess Invariant Expression** (Rate 1-10):
   - How clearly are invariants communicated through the type's structure?
   - Are invariants enforced at compile-time where possible?
   - Is the type self-documenting through its design?
   - Are edge cases and constraints obvious from the type definition?

4. **Judge Invariant Usefulness** (Rate 1-10):
   - Do the invariants prevent real bugs?
   - Are they aligned with business requirements?
   - Do they make the code easier to reason about?
   - Are they neither too restrictive nor too permissive?

5. **Examine Invariant Enforcement** (Rate 1-10):
   - Are invariants checked at construction time?
   - Are all mutation points guarded?
   - Is it impossible to create invalid instances?
   - Are runtime checks appropriate and comprehensive?

**Output Format:**

Provide your analysis in this structure:

\`\`\`
## Type: [TypeName]

### Invariants Identified
- [List each invariant with a brief description]

### Ratings
- **Encapsulation**: X/10
  [Brief justification]

- **Invariant Expression**: X/10
  [Brief justification]

- **Invariant Usefulness**: X/10
  [Brief justification]

- **Invariant Enforcement**: X/10
  [Brief justification]

### Strengths
[What the type does well]

### Concerns
[Specific issues that need attention]

### Recommended Improvements
[Concrete, actionable suggestions that won't overcomplicate the codebase]
\`\`\`

**Key Principles:**

- Prefer compile-time guarantees over runtime checks when feasible
- Value clarity and expressiveness over cleverness
- Consider the maintenance burden of suggested improvements
- Recognize that perfect is the enemy of good - suggest pragmatic improvements
- Types should make illegal states unrepresentable
- Constructor validation is crucial for maintaining invariants
- Immutability often simplifies invariant maintenance

**Common Anti-patterns to Flag:**

- Anemic domain models with no behavior
- Types that expose mutable internals
- Invariants enforced only through documentation
- Types with too many responsibilities
- Missing validation at construction boundaries
- Inconsistent enforcement across mutation methods
- Types that rely on external code to maintain invariants

**When Suggesting Improvements:**

Always consider:
- The complexity cost of your suggestions
- Whether the improvement justifies potential breaking changes
- The skill level and conventions of the existing codebase
- Performance implications of additional validation
- The balance between safety and usability

Think deeply about each type's role in the larger system. Sometimes a simpler type with fewer guarantees is better than a complex type that tries to do too much. Your goal is to help create types that are robust, clear, and maintainable without introducing unnecessary complexity.

Map each finding to severity (critical/important/suggestion) and confidence (0-100). Only report findings with confidence >= 50.`
}

const STANDARDIZATION_SUFFIX = `Format each finding's description as: what the issue is, why it matters, and (if applicable) a concrete fix. 2-4 sentences. Write in a neutral technical voice — do not reference yourself, your role, or your review methodology.`

// Main execution
phase('Analyze')

const filtered = Array.isArray(config.agents)
  ? config.agents.filter(name => typeof PROMPTS[name] === 'string')
  : []
if (filtered.indexOf('code-reviewer') === -1) filtered.unshift('code-reviewer')
const selected = filtered
log('Running ' + selected.length + ' review agents: ' + selected.join(', '))

const AGENT_OPTS = {
  'code-reviewer':         { model: 'opus', effort: 'max' },
  'silent-failure-hunter': { effort: 'high' },
  'pr-test-analyzer':      { effort: 'high' },
  'comment-analyzer':      { effort: 'high' },
  'type-design-analyzer':  { effort: 'high' }
}

const results = await parallel(selected.map(name => () => {
  const prompt = PROMPTS[name] + '\n\n' + STANDARDIZATION_SUFFIX + '\n\n' + diffPreamble()
  const overrides = AGENT_OPTS[name] || {}
  const opts = Object.assign(
    { label: name, schema: FINDING_SCHEMA, phase: 'Analyze', effort: 'high' },
    overrides
  )
  return agent(prompt, opts)
}))

let allFindings = []
const allPositive = []
results.filter(Boolean).forEach(r => {
  if (r.findings) allFindings.push(...r.findings)
  if (r.positiveObservations) allPositive.push(...r.positiveObservations)
})

const severityOrder = { critical: 0, important: 1, suggestion: 2 }
allFindings.sort((a, b) => {
  const sevDiff = (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3)
  if (sevDiff !== 0) return sevDiff
  return (b.confidence || 0) - (a.confidence || 0)
})

// Verify each finding against the diff
phase('Verify')
log('Verifying ' + allFindings.length + ' finding(s)')

const verifyResults = await parallel(allFindings.map(finding => () => {
  const verifyPrompt = `You are an adversarial code review verifier. Your job is to independently verify or refute a finding from a code review.

## The finding

- File: ${finding.file}${finding.line ? ':' + finding.line : ''}
- Severity: ${finding.severity}
- Title: ${finding.title}
- Description: ${finding.description}

${diffPreamble()}

## Your task

1. Locate the exact code referenced by this finding in the diff
2. Confirm the issue actually exists at the stated location
3. Check whether the described impact is real
4. Attempt to disprove the finding — look for reasons it might be wrong

Default to skepticism. If the finding cannot be confirmed in the diff, mark it as false_positive.`

  return agent(verifyPrompt, {
    label: 'verify:' + finding.file + (finding.line ? ':' + finding.line : ''),
    schema: VERIFY_SCHEMA,
    phase: 'Verify',
    model: 'sonnet',
    effort: 'high'
  })
}))

const verifiedFindings = []
let falsePositiveCount = 0
let verificationErrorCount = 0
allFindings.forEach((finding, i) => {
  const v = verifyResults[i]
  if (!v) {
    verificationErrorCount++
    verifiedFindings.push(Object.assign({}, finding, {
      verificationStatus: 'unverified',
      verificationRationale: 'Verification unavailable — finding retained without independent verification.'
    }))
    return
  }
  if (v.verification === 'false_positive') {
    falsePositiveCount++
    return
  }
  verifiedFindings.push(Object.assign({}, finding, {
    verificationStatus: 'verified',
    verificationRationale: v.rationale
  }))
})

verifiedFindings.sort((a, b) => {
  const sevDiff = (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3)
  if (sevDiff !== 0) return sevDiff
  return (b.confidence || 0) - (a.confidence || 0)
})

allFindings = verifiedFindings
log('Verification complete: ' + verifiedFindings.length + ' confirmed, ' + falsePositiveCount + ' filtered, ' + verificationErrorCount + ' verifier error(s)')

// Contextualize findings against existing review threads
phase('Contextualize')
log('Fetching existing review threads')

const fetchPrompt = `Fetch the authenticated user login via \`get_me\`, and all review comment threads via \`pull_request_read\` with method \`get_review_comments\` for ${config.owner}/${config.repo} PR #${config.pullNumber}. Paginate if needed to get all threads. For each thread, populate \`id\` (the thread node ID), \`author\` (the GitHub login of the first comment's author, matching the format returned by \`get_me\`), \`isResolved\`, and include the thread's replies. Return \`threads\` and \`myUsername\` as structured output.`

const threadData = await agent(fetchPrompt, {
  label: 'fetch-threads',
  schema: THREAD_SCHEMA,
  phase: 'Contextualize',
  model: 'haiku',
  effort: 'low'
})

const threads = (threadData && threadData.threads) || []
const myUsername = (threadData && threadData.myUsername) || ''

if (threads.length === 0) {
  log('No existing review threads — all ' + allFindings.length + ' finding(s) are new')
  const enriched = allFindings.map(f => Object.assign({}, f, { status: 'new' }))
  return {
    findings: enriched,
    positiveObservations: allPositive,
    threadVerifications: [],
    reviewMeta: {
      hasOwnResolvedThreads: false,
      existingThreadCount: 0,
      duplicateCount: 0,
      partialOverlapCount: 0,
      newCount: allFindings.length
    }
  }
}

log('Found ' + threads.length + ' existing thread(s) — classifying findings and verifying resolved threads')

const findingsJson = JSON.stringify(allFindings)
const threadsJson = JSON.stringify(threads)

const classifyPrompt = `You are comparing code review findings against existing review comment threads on a PR.

## Existing review threads

${threadsJson}

## Our findings

${findingsJson}

For each finding (by its index in the array), classify it:
- "new": no existing thread covers this issue
- "duplicate": an existing thread fully covers the same concern — same file, same logical concern (not just physical proximity), same fundamental problem. Provide matchedThreadId and existingCoverage (brief summary of what the thread already says).
- "partial_overlap": an existing thread touches the same area but our finding adds something the thread missed. Provide matchedThreadId, existingCoverage, delta (what we found that others missed), and rescore with adjustedSeverity and adjustedConfidence reflecting the incremental value of our finding.

Be precise: two comments about the same file are not duplicates unless they identify the same problem. A thread about error handling on line 42 is not a duplicate of a finding about a race condition on line 45.

For partial overlaps, increase adjustedConfidence if our finding caught something critical that the existing thread only tangentially mentioned. Decrease it if the existing thread mostly covers the issue and our finding only adds a minor nuance.`

const myResolvedThreads = threads.filter(t => t.isResolved && t.author === myUsername)

const contextualizeAgents = [
  () => agent(classifyPrompt, {
    label: 'classify-findings',
    schema: CLASSIFICATION_SCHEMA,
    phase: 'Contextualize',
    effort: 'high'
  })
]

if (myResolvedThreads.length > 0) {
  const resolvedJson = JSON.stringify(myResolvedThreads)
  const verifyPrompt = `You are verifying whether previous review comments have been addressed on ${config.owner}/${config.repo} PR #${config.pullNumber}.

The following review threads were left by the current user (${myUsername}) and have been marked as resolved:

${resolvedJson}

${diffPreamble()}

For each resolved thread, determine how it was resolved:
- "fixed": the author pushed code changes to address the concern. Check the diff to verify the fix is complete and doesn't introduce a new issue.
- "pushed_back": the author replied with reasoning for why the current code is correct or why the change isn't needed. Evaluate whether the pushback is technically valid.
- "unaddressed": the thread was resolved but the underlying issue remains in the code — neither fixed nor convincingly argued against.

Set isAdequate to true if the resolution satisfactorily addresses the original concern. Set newIssueIntroduced to true if a fix attempt created a new problem, and describe it in newIssueDescription.`

  contextualizeAgents.push(() => agent(verifyPrompt, {
    label: 'verify-threads',
    schema: VERIFICATION_SCHEMA,
    phase: 'Contextualize',
    effort: 'high'
  }))
}

const contextResults = await parallel(contextualizeAgents)
const classificationResult = contextResults[0]
const verificationResult = contextResults.length > 1 ? contextResults[1] : null

const classMap = {}
const classifications = (classificationResult && classificationResult.classifications) || []
classifications.forEach(c => {
  if (!Number.isInteger(c.findingIndex) || c.findingIndex < 0 || c.findingIndex >= allFindings.length) return
  if (c.status === 'duplicate' && !c.matchedThreadId) {
    classMap[c.findingIndex] = { findingIndex: c.findingIndex, status: 'new' }
  } else if (c.status === 'partial_overlap' && (!c.matchedThreadId || !c.delta)) {
    classMap[c.findingIndex] = { findingIndex: c.findingIndex, status: 'new' }
  } else {
    classMap[c.findingIndex] = c
  }
})

let duplicateCount = 0
let partialOverlapCount = 0
let newCount = 0

const enrichedFindings = allFindings.map((f, i) => {
  const c = classMap[i]
  if (!c) {
    newCount++
    return Object.assign({}, f, { status: 'new' })
  }
  if (c.status === 'duplicate') duplicateCount++
  else if (c.status === 'partial_overlap') partialOverlapCount++
  else newCount++

  const enriched = Object.assign({}, f, { status: c.status })
  if (c.matchedThreadId) enriched.matchedThreadId = c.matchedThreadId
  if (c.existingCoverage) enriched.existingCoverage = c.existingCoverage
  if (c.delta) enriched.delta = c.delta
  if (c.adjustedSeverity) enriched.adjustedSeverity = c.adjustedSeverity
  if (c.adjustedConfidence != null) enriched.adjustedConfidence = c.adjustedConfidence
  return enriched
})

const verifications = (verificationResult && verificationResult.verifications) || []

log('Contextualize complete: ' + newCount + ' new, ' + duplicateCount + ' duplicate(s), ' + partialOverlapCount + ' partial overlap(s), ' + verifications.length + ' thread(s) verified')

return {
  findings: enrichedFindings,
  positiveObservations: allPositive,
  threadVerifications: verifications,
  reviewMeta: {
    hasOwnResolvedThreads: myResolvedThreads.length > 0,
    existingThreadCount: threads.length,
    duplicateCount: duplicateCount,
    partialOverlapCount: partialOverlapCount,
    newCount: newCount
  }
}
