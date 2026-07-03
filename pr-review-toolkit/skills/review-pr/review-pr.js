export const meta = {
  name: 'review-pr',
  description: 'Comprehensive PR review board with shared PR context',
  phases: [
    { title: 'Collect', detail: 'Collect PR metadata, changed files, and review threads' },
    { title: 'Analyze', detail: 'Run specialized review agents from shared PR context' },
    { title: 'Synthesize', detail: 'Build a grouped review board' }
  ]
}

const PR_METADATA_SCHEMA = {
  type: 'object',
  properties: {
    pr: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        number: { type: 'number' },
        title: { type: 'string' },
        body: { type: 'string' },
        author: { type: 'string' },
        baseRef: { type: 'string' },
        headSha: { type: 'string' },
        changedFiles: { type: 'number' },
        additions: { type: 'number' },
        deletions: { type: 'number' },
        state: { type: 'string' },
        reviewDecision: { type: 'string' }
      },
      required: ['owner', 'repo', 'number', 'title', 'author', 'baseRef', 'headSha', 'changedFiles', 'additions', 'deletions']
    }
  },
  required: ['pr']
}

const FILE_PAGE_SCHEMA = {
  type: 'object',
  properties: {
    page: { type: 'number' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          status: { type: 'string' },
          additions: { type: 'number' },
          deletions: { type: 'number' },
          category: {
            type: 'string',
            enum: ['source', 'tests', 'docs', 'config', 'ci', 'generated', 'vendor', 'lockfile', 'binary', 'other']
          },
          signals: {
            type: 'array',
            items: { type: 'string' }
          },
          patchAvailable: { type: 'boolean' }
        },
        required: ['path', 'status', 'additions', 'deletions', 'category', 'signals', 'patchAvailable']
      }
    }
  },
  required: ['page', 'files']
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          location: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              line: { type: 'number' }
            },
            required: ['path']
          },
          severity: { type: 'string', enum: ['critical', 'important', 'suggestion'] },
          confidence: { type: 'number', minimum: 0, maximum: 100 },
          title: { type: 'string' },
          claim: { type: 'string' },
          evidence: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              details: {
                type: 'array',
                items: { type: 'string' }
              },
              references: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    line: { type: 'number' },
                    threadId: { type: 'string' },
                    detail: { type: 'string' }
                  },
                  required: ['detail']
                }
              }
            },
            required: ['summary', 'details']
          },
          reasoning: { type: 'string' },
          whyItMatters: { type: 'string' },
          suggestedFix: { type: 'string' },
          postability: {
            type: 'object',
            properties: {
              recommendation: {
                type: 'string',
                enum: ['recommended_to_post', 'overlaps', 'discussion_only', 'already_covered', 'discard']
              },
              rationale: { type: 'string' },
              existingThreadIds: {
                type: 'array',
                items: { type: 'string' }
              },
              caveats: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['recommendation', 'rationale', 'existingThreadIds', 'caveats']
          }
        },
        required: ['location', 'severity', 'confidence', 'title', 'claim', 'evidence', 'reasoning', 'whyItMatters', 'suggestedFix', 'postability']
      }
    },
    positiveObservations: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['findings', 'positiveObservations']
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
          commentId: { type: 'number' },
          path: { type: 'string' },
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
        required: ['id', 'path', 'author', 'body', 'isResolved']
      }
    }
  },
  required: ['threads']
}

const BOARD_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    lens: { type: 'string' },
    title: { type: 'string' },
    severity: { type: 'string', enum: ['critical', 'important', 'suggestion'] },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    location: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        line: { type: 'number' }
      },
      required: ['path']
    },
    claim: { type: 'string' },
    evidence: { type: 'string' },
    whyItMatters: { type: 'string' },
    suggestedFix: { type: 'string' },
    existingReviewOverlap: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['none', 'overlaps', 'already_covered']
        },
        threadId: { type: 'string' },
        commentId: { type: 'number' },
        rationale: { type: 'string' }
      },
      required: ['status', 'rationale']
    },
    sourceAgent: { type: 'string' }
  },
  required: ['id', 'lens', 'title', 'severity', 'confidence', 'location', 'claim', 'evidence', 'whyItMatters', 'suggestedFix', 'existingReviewOverlap', 'sourceAgent']
}

const REVIEW_BOARD_SCHEMA = {
  type: 'object',
  properties: {
    recommendedToPost: {
      type: 'array',
      items: BOARD_ITEM_SCHEMA
    },
    relatedToExisting: {
      type: 'array',
      items: BOARD_ITEM_SCHEMA
    },
    discussionOnly: {
      type: 'array',
      items: BOARD_ITEM_SCHEMA
    },
    alreadyCovered: {
      type: 'array',
      items: BOARD_ITEM_SCHEMA
    },
    discarded: {
      type: 'array',
      items: BOARD_ITEM_SCHEMA
    },
    positiveObservations: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['recommendedToPost', 'relatedToExisting', 'discussionOnly', 'alreadyCovered', 'discarded', 'positiveObservations']
}

let config = {}
if (typeof args === 'string') {
  try {
    config = JSON.parse(args)
  } catch (err) {
    throw new Error('review-pr workflow expected JSON args string: ' + err.message)
  }
} else {
  config = args || {}
}

if (!config.owner || !config.repo || !config.pullNumber) {
  throw new Error('review-pr requires args: owner, repo, pullNumber')
}

const localGitManifest = Array.isArray(config.localGitManifest) ? config.localGitManifest : null
const fullDiff = typeof config.fullDiff === 'string' ? config.fullDiff : null
const configSources = config.sources || null

const SEVERITY_ORDER = { critical: 0, important: 1, suggestion: 2 }
function sortFindings(arr) {
  arr.sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
    if (sevDiff !== 0) return sevDiff
    return (b.confidence || 0) - (a.confidence || 0)
  })
}

// Agent prompts derived from Anthropic's pr-review-toolkit plugin
// (https://github.com/anthropics/claude-plugins-official), Apache-2.0 licensed.
// YAML frontmatter stripped; prompts embedded as string literals for Workflow use.

const REVIEWER_PROMPTS = {
  'code-reviewer': `You are an expert code reviewer specializing in modern software development across multiple languages and frameworks. Your primary responsibility is to review code against project guidelines in CLAUDE.md with high precision to minimize false positives.

## Review Scope

Review the shared PR context provided below. Use the focused patch access instructions when raw diff details are needed for high-signal files.

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

const STANDARDIZATION_SUFFIX = `Return only high-signal candidate findings. For each finding, provide a concise title, a concrete claim, structured evidence, specialist reasoning, why it matters, and a specific suggested fix when applicable. Include a postability recommendation for human review only: recommended_to_post, overlaps, discussion_only, already_covered, or discard. Preserve concrete evidence from patches, files, and existing threads; do not collapse reasoning into generic summaries. Use a neutral technical voice and do not reference yourself, your role, or your review methodology.`

const FILE_PAGE_SIZE = 10
const FILE_SINGLE_PAGE_RETRIES = 2
// Workflow agent() calls cannot pass per-call tool allowlists, so phase-specific
// plugin agent types define the tool boundary for spawned agents.
const GITHUB_COLLECTOR_AGENT_TYPE = 'pr-review-toolkit:pr-review-github-collector'
const ANALYSIS_AGENT_TYPE = 'pr-review-toolkit:pr-review-analysis-readonly'

// Workflow scripts cannot import sibling prompt files, so reviewer prompt
// content stays embedded while orchestration reads through this registry.
const REVIEWERS = {
  'code-reviewer': {
    lens: 'code',
    prompt: REVIEWER_PROMPTS['code-reviewer'],
    options: { model: 'opus', effort: 'max' }
  },
  'silent-failure-hunter': {
    lens: 'error-handling',
    prompt: REVIEWER_PROMPTS['silent-failure-hunter'],
    options: { effort: 'high' }
  },
  'pr-test-analyzer': {
    lens: 'tests',
    prompt: REVIEWER_PROMPTS['pr-test-analyzer'],
    options: { effort: 'high' }
  },
  'comment-analyzer': {
    lens: 'comments',
    prompt: REVIEWER_PROMPTS['comment-analyzer'],
    options: { effort: 'high' }
  },
  'type-design-analyzer': {
    lens: 'type-design',
    prompt: REVIEWER_PROMPTS['type-design-analyzer'],
    options: { effort: 'high' }
  }
}

const BOARD_SECTIONS = ['recommendedToPost', 'relatedToExisting', 'discussionOnly', 'alreadyCovered', 'discarded']

function asNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function firstString(values, fallback) {
  for (const value of values || []) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

function firstLineNumber(values) {
  for (const value of values || []) {
    if (value == null || (typeof value === 'string' && !value.trim())) continue
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function candidateLocation(finding) {
  const rawLocation = finding.location || {}
  const location = {
    path: firstString([rawLocation.path, finding.file, finding.path], 'PR')
  }
  const line = firstLineNumber([rawLocation.line, finding.line])
  if (line != null) location.line = line
  return location
}

function evidenceText(finding) {
  const evidence = finding.evidence
  const parts = []

  if (typeof evidence === 'string') {
    parts.push(evidence)
  } else if (evidence) {
    if (evidence.summary) parts.push(evidence.summary)
    ;(evidence.details || []).forEach(detail => {
      if (detail) parts.push(detail)
    })
    ;(evidence.references || []).forEach(ref => {
      if (!ref || !ref.detail) return
      const refLocation = firstString([
        ref.threadId ? 'thread ' + ref.threadId : '',
        ref.path ? ref.path + (ref.line != null ? ':' + ref.line : '') : ''
      ], '')
      parts.push(refLocation ? refLocation + ': ' + ref.detail : ref.detail)
    })
  }

  if (finding.description) parts.push(finding.description)
  return parts.join('\n')
}

function whyItMattersText(finding) {
  const whyItMatters = firstString([finding.whyItMatters, finding.impact], '')
  const reasoning = firstString([finding.reasoning], '')
  if (!reasoning) return whyItMatters
  if (!whyItMatters) return reasoning
  if (whyItMatters.indexOf(reasoning) !== -1) return whyItMatters
  return whyItMatters + '\n\nSpecialist reasoning: ' + reasoning
}

function postabilityRecommendation(finding) {
  const postability = finding.postability || {}
  return postability.recommendation || ''
}

function overlapFromFinding(finding) {
  if (finding.existingReviewOverlap) return finding.existingReviewOverlap

  const postability = finding.postability || {}
  const recommendation = postability.recommendation || ''
  const threadIds = Array.isArray(postability.existingThreadIds) ? postability.existingThreadIds : []
  const status = recommendation === 'overlaps'
    ? 'overlaps'
    : recommendation === 'already_covered'
      ? 'already_covered'
      : 'none'

  return {
    status: status,
    threadId: threadIds[0] || '',
    commentId: undefined,
    rationale: postability.rationale || 'No existing review overlap was classified.'
  }
}

function compactText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function textTokens(value) {
  const stopWords = {
    a: true,
    an: true,
    and: true,
    are: true,
    as: true,
    be: true,
    by: true,
    for: true,
    from: true,
    in: true,
    is: true,
    it: true,
    of: true,
    on: true,
    or: true,
    that: true,
    the: true,
    this: true,
    to: true,
    with: true
  }
  return compactText(value).split(/\s+/).filter(token => token.length > 2 && !stopWords[token])
}

function tokenOverlap(left, right) {
  const leftTokens = uniq(textTokens(left))
  const rightTokens = uniq(textTokens(right))
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0

  const rightSet = {}
  rightTokens.forEach(token => {
    rightSet[token] = true
  })

  let overlap = 0
  leftTokens.forEach(token => {
    if (rightSet[token]) overlap++
  })
  return overlap / Math.min(leftTokens.length, rightTokens.length)
}

function findingKey(item) {
  const location = item.location || {}
  const path = location.path || 'PR'
  const line = location.line != null ? ':' + asNumber(location.line, 0) : ''
  const keywords = textTokens((item.claim || '') + ' ' + (item.title || '')).slice(0, 20)
  return path + line + '|' + (keywords.length > 0 ? keywords.join('-') : compactText(item.title || item.id || 'finding'))
}

function combinedItemText(item) {
  return [
    item.title,
    item.claim,
    item.evidence,
    item.whyItMatters,
    item.suggestedFix
  ].filter(Boolean).join('\n')
}

function threadText(thread) {
  const replies = (thread.replies || []).map(reply => reply && reply.body).filter(Boolean)
  return [thread.body].concat(replies).filter(Boolean).join('\n')
}

function combineText(left, right) {
  const parts = []
  ;[left, right].forEach(value => {
    const text = String(value || '').trim()
    if (!text) return
    if (parts.some(existing => existing === text || existing.indexOf(text) !== -1)) return
    parts.push(text)
  })
  return parts.join('\n\n')
}

function bestSeverity(left, right) {
  return (SEVERITY_ORDER[left] ?? 3) <= (SEVERITY_ORDER[right] ?? 3) ? left : right
}

function bestOverlap(left, right) {
  const order = { none: 0, overlaps: 1, already_covered: 2 }
  const leftStatus = (left && left.status) || 'none'
  const rightStatus = (right && right.status) || 'none'
  const selected = (order[rightStatus] > order[leftStatus]) ? right : left
  if (!selected) return { status: 'none', threadId: '', rationale: '' }

  return {
    status: selected.status || 'none',
    threadId: selected.threadId || '',
    commentId: selected.commentId || (right && right.commentId) || (left && left.commentId) || undefined,
    rationale: combineText(left && left.rationale, right && right.rationale)
  }
}

function mergeBoardItem(base, next) {
  return {
    id: base.id || next.id,
    lens: uniq(String(base.lens || '').split(', ').concat(String(next.lens || '').split(', '))).join(', '),
    title: base.title || next.title,
    severity: bestSeverity(base.severity, next.severity),
    confidence: Math.max(asNumber(base.confidence, 0), asNumber(next.confidence, 0)),
    location: base.location || next.location || { path: 'PR' },
    claim: base.claim || next.claim || base.title || next.title || 'Review finding',
    evidence: combineText(base.evidence, next.evidence),
    whyItMatters: combineText(base.whyItMatters, next.whyItMatters),
    suggestedFix: combineText(base.suggestedFix, next.suggestedFix),
    existingReviewOverlap: bestOverlap(base.existingReviewOverlap, next.existingReviewOverlap),
    sourceAgent: uniq(String(base.sourceAgent || '').split(', ').concat(String(next.sourceAgent || '').split(', '))).join(', ')
  }
}

function inferThreadOverlap(item, threads) {
  const existing = item.existingReviewOverlap || {}
  if (existing.status && existing.status !== 'none') {
    if (!existing.commentId && existing.threadId) {
      const matched = (threads || []).find(t => t && t.id === existing.threadId)
      if (matched && matched.commentId) {
        return Object.assign({}, existing, { commentId: matched.commentId })
      }
    }
    if (existing.threadId || existing.commentId) return existing
  }

  const location = item.location || {}
  const itemText = combinedItemText(item)
  let best = null
  ;(threads || []).forEach(thread => {
    if (!thread || !thread.path || thread.path !== location.path) return
    const sameLine = location.line != null && thread.line != null && asNumber(location.line, -1) === asNumber(thread.line, -2)
    const nearLine = location.line != null && thread.line != null && Math.abs(asNumber(location.line, 0) - asNumber(thread.line, 999999)) <= 8
    const overlap = tokenOverlap(itemText, threadText(thread))
    const minimumOverlap = sameLine ? 0.2 : nearLine ? 0.3 : 0.45
    if (overlap < minimumOverlap) return

    const score = overlap + (sameLine ? 0.1 : nearLine ? 0.05 : 0)
    if (!best || score > best.score) {
      best = { thread: thread, overlap: overlap, sameLine: sameLine, nearLine: nearLine, score: score }
    }
  })

  if (!best) {
    return {
      status: 'none',
      threadId: existing.threadId || '',
      commentId: existing.commentId || undefined,
      rationale: existing.rationale || 'No existing review overlap was classified.'
    }
  }

  const status = best.thread.isResolved && best.overlap >= 0.25
    ? 'already_covered'
    : 'overlaps'

  return {
    status: status,
    threadId: best.thread.id || '',
    commentId: best.thread.commentId || undefined,
    rationale: 'Inferred overlap with an existing review thread on ' + location.path + (best.thread.line != null ? ':' + best.thread.line : '') + '.'
  }
}

function routeSection(item, preferredSection, recommendation) {
  const overlap = item.existingReviewOverlap || {}
  if (preferredSection === 'discarded' || recommendation === 'discard') return 'discarded'
  if (overlap.status === 'already_covered' || recommendation === 'already_covered') return 'alreadyCovered'
  if (overlap.status === 'overlaps' || recommendation === 'overlaps') return 'relatedToExisting'
  if (recommendation === 'discussion_only') return 'discussionOnly'
  if (recommendation === 'recommended_to_post') return 'recommendedToPost'
  if (BOARD_SECTIONS.indexOf(preferredSection) !== -1) return preferredSection
  if (asNumber(item.confidence, 0) < 50) return 'discarded'
  if ((item.severity === 'critical' || item.severity === 'important') && asNumber(item.confidence, 0) >= 80) return 'recommendedToPost'
  return 'discussionOnly'
}

function bestRecommendation(left, right) {
  const order = {
    discard: 0,
    already_covered: 1,
    discussion_only: 2,
    overlaps: 3,
    recommended_to_post: 4
  }
  const leftScore = Object.prototype.hasOwnProperty.call(order, left) ? order[left] : -1
  const rightScore = Object.prototype.hasOwnProperty.call(order, right) ? order[right] : -1
  return rightScore > leftScore ? right : left
}

function mergeBoardEntries(entries) {
  const byKey = {}
  const order = []
  ;(entries || []).forEach(entry => {
    if (!entry || !entry.item) return
    const key = findingKey(entry.item)
    if (!byKey[key]) {
      byKey[key] = entry
      order.push(key)
      return
    }
    byKey[key] = {
      item: mergeBoardItem(byKey[key].item, entry.item),
      section: byKey[key].section || entry.section,
      recommendation: bestRecommendation(byKey[key].recommendation, entry.recommendation)
    }
  })
  return order.map(key => byKey[key])
}

function normalizeBoardSections(board, prContext) {
  const entries = []
  BOARD_SECTIONS.forEach(section => {
    ;(board[section] || []).forEach(item => {
      if (!item) return
      item.existingReviewOverlap = inferThreadOverlap(item, prContext.threads)
      entries.push({ item: item, section: section })
    })
  })

  const normalized = {}
  BOARD_SECTIONS.forEach(section => {
    normalized[section] = []
  })

  mergeBoardEntries(entries).forEach(entry => {
    const section = routeSection(entry.item, entry.section, entry.recommendation)
    normalized[section].push(entry.item)
  })

  BOARD_SECTIONS.forEach(section => {
    sortFindings(normalized[section])
    board[section] = normalized[section]
  })
}

function uniq(values) {
  const seen = {}
  const out = []
  ;(values || []).forEach(value => {
    if (!value || seen[value]) return
    seen[value] = true
    out.push(value)
  })
  return out
}

function categorizePath(path) {
  const p = String(path || '').toLowerCase()
  if (!p) return 'other'
  if (p.indexOf('vendor/') === 0 || p.indexOf('/vendor/') !== -1 || p.indexOf('third_party/') === 0 || p.indexOf('/third_party/') !== -1) return 'vendor'
  if (p.indexOf('generated') !== -1 || p.indexOf('zz_generated') !== -1 || p.endsWith('.pb.go') || p.endsWith('.pb.ts') || p.endsWith('.pb.js') || p.endsWith('_generated.go') || p.endsWith('_string.go')) return 'generated'
  if (p.endsWith('go.sum') || p.endsWith('package-lock.json') || p.endsWith('yarn.lock') || p.endsWith('pnpm-lock.yaml') || p.endsWith('cargo.lock') || p.endsWith('gemfile.lock') || p.endsWith('poetry.lock')) return 'lockfile'
  if (p.indexOf('.github/workflows/') === 0 || p.indexOf('/.github/workflows/') !== -1 || p.indexOf('ci/') === 0 || p.indexOf('/ci/') !== -1) return 'ci'
  if (p.endsWith('.md') || p.endsWith('.mdx') || p.endsWith('.rst') || p.indexOf('docs/') === 0 || p.indexOf('/docs/') !== -1) return 'docs'
  if (p.endsWith('.json') || p.endsWith('.yaml') || p.endsWith('.yml') || p.endsWith('.toml') || p.endsWith('.ini') || p.endsWith('.cfg') || p.endsWith('.conf')) return 'config'
  if (p.indexOf('test/') !== -1 || p.indexOf('tests/') !== -1 || p.indexOf('__tests__/') !== -1 || p.endsWith('_test.go') || p.endsWith('.test.ts') || p.endsWith('.test.tsx') || p.endsWith('.spec.ts') || p.endsWith('.spec.tsx') || p.endsWith('_test.py')) return 'tests'
  if (/\.(go|ts|tsx|js|jsx|py|rs|java|kt|kts|c|cc|cpp|h|hpp|cs|rb|php|swift)$/.test(p)) return 'source'
  if (/\.(png|jpg|jpeg|gif|webp|pdf|zip|gz|tar|tgz|ico|woff|woff2|ttf)$/.test(p)) return 'binary'
  return 'other'
}

function signalsForFile(file) {
  const p = String(file.path || '').toLowerCase()
  const signals = Array.isArray(file.signals) ? file.signals.slice() : []
  const category = file.category || categorizePath(file.path)
  if (category === 'source') signals.push('source')
  if (category === 'tests') signals.push('tests')
  if (category === 'docs') signals.push('comments')
  if (category === 'config' || category === 'ci') signals.push('config')
  if (p.indexOf('error') !== -1 || p.indexOf('exception') !== -1 || p.indexOf('fallback') !== -1 || p.indexOf('retry') !== -1 || p.indexOf('handler') !== -1) signals.push('error-handling')
  if (/\.(ts|tsx|go|rs|java|kt|cs)$/.test(p) || p.indexOf('types') !== -1 || p.indexOf('model') !== -1 || p.indexOf('schema') !== -1 || p.indexOf('interface') !== -1) signals.push('types')
  if (p.indexOf('api') !== -1 || p.indexOf('client') !== -1 || p.indexOf('server') !== -1 || p.indexOf('controller') !== -1 || p.indexOf('route') !== -1) signals.push('public-api')
  return uniq(signals)
}

function normalizePr(prResult) {
  const raw = prResult && prResult.pr ? prResult.pr : {}
  return {
    owner: raw.owner || config.owner || '',
    repo: raw.repo || config.repo || '',
    number: asNumber(raw.number, asNumber(config.pullNumber, 0)),
    title: raw.title || '',
    body: raw.body || '',
    author: raw.author || '',
    baseRef: raw.baseRef || config.baseRef || '',
    headSha: raw.headSha || config.headSha || '',
    changedFiles: asNumber(raw.changedFiles, asNumber(config.changedFiles, 0)),
    additions: asNumber(raw.additions, 0),
    deletions: asNumber(raw.deletions, 0),
    state: raw.state || '',
    reviewDecision: raw.reviewDecision || ''
  }
}

function mergeFilePages(pageResults, perPage) {
  const byPath = {}
  ;(pageResults || []).filter(Boolean).forEach((pageResult, pageIndex) => {
    const page = asNumber(pageResult.page, pageIndex + 1)
    const resultPerPage = asNumber(pageResult.perPage, perPage || FILE_PAGE_SIZE)
    ;(pageResult.files || []).forEach(file => {
      if (!file || !file.path) return
      const category = file.category || categorizePath(file.path)
      byPath[file.path] = {
        path: file.path,
        status: file.status || 'modified',
        additions: asNumber(file.additions, 0),
        deletions: asNumber(file.deletions, 0),
        category: category,
        signals: signalsForFile(Object.assign({}, file, { category: category })),
        patchAvailable: Boolean(file.patchAvailable),
        page: page,
        perPage: resultPerPage,
        threadCount: 0
      }
    })
  })
  return Object.keys(byPath).sort().map(path => byPath[path])
}

function duplicateFilePageSummary(pageResults) {
  const pathPages = {}
  ;(pageResults || []).filter(Boolean).forEach((pageResult, pageIndex) => {
    const page = asNumber(pageResult.page, pageIndex + 1)
    ;(pageResult.files || []).forEach(file => {
      if (!file || !file.path) return
      if (!pathPages[file.path]) pathPages[file.path] = []
      if (pathPages[file.path].indexOf(page) === -1) pathPages[file.path].push(page)
    })
  })

  const duplicatePaths = Object.keys(pathPages).filter(path => pathPages[path].length > 1)
  const duplicatePages = uniq(duplicatePaths.flatMap(path => pathPages[path])).sort((a, b) => a - b)
  return {
    duplicatePathCount: duplicatePaths.length,
    duplicatePages: duplicatePages,
    examples: duplicatePaths.slice(0, 5).map(path => path + ' on pages ' + pathPages[path].join(', '))
  }
}

function fileManifestErrorMessage(expectedTotal, actualTotal, pageResults) {
  const duplicateSummary = duplicateFilePageSummary(pageResults)
  let message = 'Changed-file manifest incomplete: expected ' + expectedTotal + ', got ' + actualTotal
  if (duplicateSummary.duplicatePathCount) {
    message += '. Duplicate paths appeared across file pages: ' + duplicateSummary.duplicatePathCount
    message += '; affected pages: ' + duplicateSummary.duplicatePages.join(', ')
    message += '; examples: ' + duplicateSummary.examples.join('; ')
  }
  return message
}

function filePageResultIssues(pageResults, expectedTotal, pageCount, perPage) {
  if (!expectedTotal) return []

  const issues = []
  for (let page = 1; page <= pageCount; page++) {
    const expected = expectedFilesForPage(expectedTotal, page, perPage || FILE_PAGE_SIZE)
    const result = (pageResults || []).find(item => asNumber(item && item.page, 0) === page)
    const actual = result && Array.isArray(result.files) ? result.files.length : 0
    if (actual !== expected) {
      issues.push({
        page: page,
        expected: expected,
        actual: actual
      })
    }
  }
  return issues
}

function filePageIssueSummary(issues) {
  const issueList = issues || []
  if (!issueList.length) return ''
  return issueList.slice(0, 5).map(issue => {
    return 'page ' + issue.page + ' expected ' + issue.expected + ', got ' + issue.actual
  }).join('; ') + (issueList.length > 5 ? '; ...' : '')
}

function expectedFilesForPage(total, page, perPage) {
  const remaining = total - ((page - 1) * perPage)
  return Math.max(0, Math.min(perPage, remaining))
}

function collectFilePage(pr, page, perPage, effort, labelSuffix) {
  const prompt = `Collect one changed-file page.

Call exactly once: pull_request_read(method=get_files, owner=${pr.owner}, repo=${pr.repo}, pullNumber=${pr.number}, page=${page}, perPage=${perPage}).

Return structured output only:
- page: exactly ${page}
- files: exactly the visible files from that API response
- map filename to path
- include status, additions, deletions
- category and signals must come from path/status metadata only
- patchAvailable is true only when the visible API entry has a non-empty patch
- omit patch text

If the patch body is too large or truncated but filename, status, additions, and deletions are visible, still return the file metadata. The manifest does not need the patch body. Set patchAvailable to true when a non-empty patch field is visible, even if that patch content is truncated.
If the tool result is unavailable or saved to a local file, do not inspect the saved file. Return page ${page} with an empty files array so the workflow can retry with a single-file read.
Return an empty files array only when the file metadata itself is not visible or the GitHub read failed.

Do not fetch other pages, reuse another page's data, infer missing files, or renumber pages.`
  return agent(prompt, {
    label: 'collect-files-page-' + page + (labelSuffix || ''),
    schema: FILE_PAGE_SCHEMA,
    phase: 'Collect',
    agentType: GITHUB_COLLECTOR_AGENT_TYPE,
    model: 'haiku',
    effort: effort || 'high'
  })
}

async function collectFilePages(pr, filePages, perPage, effort, labelSuffix) {
  const results = await parallel(filePages.map(page => () => collectFilePage(pr, page, perPage, effort, labelSuffix)))
  return (results || []).map(result => result ? Object.assign({}, result, { perPage: perPage }) : result)
}

function filePageNumbersForIssues(issues, sourcePerPage, total) {
  const pages = []
  const seen = {}
  ;(issues || []).forEach(issue => {
    const start = ((issue.page - 1) * sourcePerPage) + 1
    const end = Math.min(issue.page * sourcePerPage, total || start)
    for (let page = start; page <= end; page++) {
      if (seen[page]) continue
      seen[page] = true
      pages.push(page)
    }
  })
  return pages.sort((a, b) => a - b)
}

function missingSingleFilePages(pageResults, pages) {
  return (pages || []).filter(page => {
    const result = (pageResults || []).find(item => asNumber(item && item.page, 0) === page)
    const actual = result && Array.isArray(result.files) ? result.files.length : 0
    return actual !== 1
  })
}

function filePagesFor(total, perPage) {
  const pageCount = Math.max(1, Math.ceil((total || 1) / perPage))
  const pages = []
  for (let page = 1; page <= pageCount; page++) pages.push(page)
  return { pageCount: pageCount, pages: pages }
}

async function collectCompleteFileManifest(pr) {
  const pagination = filePagesFor(pr.changedFiles, FILE_PAGE_SIZE)
  log('Fetching changed files across ' + pagination.pageCount + ' page(s) with perPage ' + FILE_PAGE_SIZE)
  const primaryResults = await collectFilePages(pr, pagination.pages, FILE_PAGE_SIZE, 'high', '')
  const primaryIssues = filePageResultIssues(primaryResults, pr.changedFiles, pagination.pageCount, FILE_PAGE_SIZE)
  const primaryIssuePages = {}
  primaryIssues.forEach(issue => {
    primaryIssuePages[issue.page] = true
  })
  let recoveryResults = []
  let recoveryAttempts = 0
  let recoveredFileSlots = 0

  if (primaryIssues.length) {
    const singlePages = filePageNumbersForIssues(primaryIssues, FILE_PAGE_SIZE, pr.changedFiles)
    log('Changed-file collection incomplete on ' + primaryIssues.length + ' page(s): ' + filePageIssueSummary(primaryIssues) + '. Recovering ' + singlePages.length + ' file slot(s) with perPage 1.')

    let remainingPages = singlePages
    for (let attempt = 1; attempt <= FILE_SINGLE_PAGE_RETRIES && remainingPages.length; attempt++) {
      recoveryAttempts = attempt
      const attemptResults = await collectFilePages(pr, remainingPages, 1, 'high', '-recover-' + attempt)
      recoveryResults = recoveryResults.concat(attemptResults)
      remainingPages = missingSingleFilePages(attemptResults, remainingPages)
      if (remainingPages.length && attempt < FILE_SINGLE_PAGE_RETRIES) {
        log('Single-file recovery attempt ' + attempt + ' still missing ' + remainingPages.length + ' file slot(s); retrying.')
      }
    }
    recoveredFileSlots = singlePages.length - remainingPages.length

    if (remainingPages.length) {
      throw new Error('Changed-file collection incomplete after single-file recovery: missing file slot(s) ' + remainingPages.slice(0, 10).join(', ') + (remainingPages.length > 10 ? ', ...' : '') + '. The GitHub MCP result may be unavailable before file metadata is visible.')
    }
  }

  const pageResults = primaryResults
    .filter(result => !primaryIssuePages[asNumber(result && result.page, 0)])
    .concat(recoveryResults)
  const files = mergeFilePages(pageResults, FILE_PAGE_SIZE)
  if (pr.changedFiles && files.length !== pr.changedFiles) {
    throw new Error(fileManifestErrorMessage(pr.changedFiles, files.length, pageResults))
  }

  return {
    files: files,
    pageResults: pageResults,
    pageCount: pagination.pageCount,
    perPage: FILE_PAGE_SIZE,
    recoveryAttempts: recoveryAttempts,
    recoveredFileSlots: recoveredFileSlots
  }
}

function buildSummary(pr, files, threads) {
  const categories = {}
  const signalCounts = {}
  files.forEach(file => {
    categories[file.category] = (categories[file.category] || 0) + 1
    ;(file.signals || []).forEach(signal => {
      signalCounts[signal] = (signalCounts[signal] || 0) + 1
    })
  })
  const threadCounts = {}
  threads.forEach(thread => {
    if (!thread.path) return
    threadCounts[thread.path] = (threadCounts[thread.path] || 0) + 1
  })
  files.forEach(file => {
    file.threadCount = threadCounts[file.path] || 0
  })

  const changed = pr.changedFiles || files.length
  const churn = (pr.additions || 0) + (pr.deletions || 0)
  const scale = changed > 250 || churn > 20000
    ? 'very_large'
    : changed > 75 || churn > 5000
      ? 'large'
      : changed > 20 || churn > 1000
        ? 'medium'
        : 'small'

  const riskAreas = []
  if (signalCounts['error-handling']) riskAreas.push('error-handling')
  if (signalCounts['types']) riskAreas.push('type-design')
  if (signalCounts['public-api']) riskAreas.push('public-api')
  if ((categories.source || 0) > 0 && (categories.tests || 0) === 0) riskAreas.push('tests')
  if ((categories.config || 0) > 0 || (categories.ci || 0) > 0) riskAreas.push('config-or-ci')

  return {
    scale: scale,
    categories: categories,
    signals: signalCounts,
    riskAreas: riskAreas,
    changedFileCount: changed,
    collectedFileCount: files.length,
    existingThreadCount: threads.length,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0
  }
}

function selectReviewers(files, summary) {
  if (Array.isArray(config.agents) && config.agents.length > 0) {
    const explicit = config.agents.filter(name => REVIEWERS[name])
    if (explicit.indexOf('code-reviewer') === -1) explicit.unshift('code-reviewer')
    return explicit
  }

  const selected = ['code-reviewer']
  const categories = summary.categories || {}
  const signals = summary.signals || {}

  if ((categories.source || 0) > 0) selected.push('pr-test-analyzer')
  if (signals['error-handling']) selected.push('silent-failure-hunter')
  if ((categories.docs || 0) > 0 || signals.comments) selected.push('comment-analyzer')
  if (signals.types) selected.push('type-design-analyzer')

  return uniq(selected).filter(name => REVIEWERS[name])
}

function contextForPrompt(prContext) {
  return JSON.stringify({
    pr: prContext.pr,
    summary: prContext.summary,
    files: prContext.files,
    threads: prContext.threads
  })
}

function patchInstructions(prContext) {
  const sources = prContext.sources || {}

  if (sources.fullDiffIncluded && prContext.fullDiff) {
    return '## Diff context\n\n'
      + 'The full merge diff is included below. Use it as your primary source for understanding what changed. '
      + 'You may also use Read and Grep on the merged checkout to inspect unchanged context, trace cross-file effects, or verify assumptions.\n\n'
      + 'Do not run Bash commands. Do not call GitHub write tools.\n\n'
      + '<full-merge-diff>\n' + prContext.fullDiff + '\n</full-merge-diff>'
  }

  if (sources.manifestSource === 'local-git') {
    return '## Diff context\n\n'
      + 'The working tree is checked out to the merge result for this PR. Full diff text was omitted because it exceeded the size cap. '
      + 'Use the file manifest for whole-PR awareness, then use Read and Grep on the merged checkout to inspect changed files and trace cross-file effects.\n\n'
      + 'Do not run Bash commands. Do not call GitHub write tools.'
  }

  return '## Focused patch access\n\n'
    + 'Use GitHub read tools only. If you need raw patch details for a focused high-signal file, '
    + 'call pull_request_read with method get_files for that file\'s recorded page and perPage, '
    + 'then inspect only the matching file\'s patch. If the matching file is not present on its '
    + 'recorded page, check at most three nearby pages with the same perPage before proceeding without the raw patch.\n\n'
    + 'Do not call any GitHub write tools.'
}

function analysisPrompt(name, prContext) {
  return REVIEWERS[name].prompt + '\n\n' + STANDARDIZATION_SUFFIX
    + '\n\n## Shared PR context\n\nThe workflow already collected PR metadata, the complete changed-file manifest, and review threads. Use this shared context for whole-PR awareness and do not refetch PR metadata, the full file list, or review threads.\n\n'
    + contextForPrompt(prContext) + '\n\n'
    + patchInstructions(prContext)
    + '\n\n## Output\n\nReturn findings that are useful candidates for a human reviewer. Postability is only a recommendation to the synthesizer; do not post comments, draft comments, request changes, approve, resolve threads, or call any GitHub write tools. Include positive observations when they help the final review board.'
}

function boardItemFromFinding(finding, index) {
  return {
    id: 'F' + (index + 1),
    lens: finding.lens || finding.sourceAgent || 'review',
    title: finding.title || 'Review finding',
    severity: finding.severity || 'suggestion',
    confidence: asNumber(finding.confidence, 0),
    location: candidateLocation(finding),
    claim: finding.claim || finding.title || 'Review finding',
    evidence: evidenceText(finding),
    whyItMatters: whyItMattersText(finding),
    suggestedFix: finding.suggestedFix || '',
    existingReviewOverlap: overlapFromFinding(finding),
    sourceAgent: finding.sourceAgent || ''
  }
}

function fallbackBoard(findings, positives, prContext) {
  const board = {
    recommendedToPost: [],
    relatedToExisting: [],
    discussionOnly: [],
    alreadyCovered: [],
    discarded: [],
    positiveObservations: positives
  }

  const entries = findings.map((finding, index) => {
    const item = boardItemFromFinding(finding, index)
    item.existingReviewOverlap = inferThreadOverlap(item, prContext.threads)
    return {
      item: item,
      recommendation: postabilityRecommendation(finding)
    }
  })

  mergeBoardEntries(entries).forEach(entry => {
    board[routeSection(entry.item, '', entry.recommendation)].push(entry.item)
  })
  BOARD_SECTIONS.forEach(section => sortFindings(board[section]))
  return board
}

function finalizeBoard(board, findings, positives, prContext) {
  const finalBoard = board || fallbackBoard(findings, positives, prContext)
  BOARD_SECTIONS.forEach(section => {
    if (!Array.isArray(finalBoard[section])) finalBoard[section] = []
  })
  normalizeBoardSections(finalBoard, prContext)

  let nextId = 1
  BOARD_SECTIONS.forEach(section => {
    finalBoard[section].forEach(item => {
      item.id = 'F' + nextId
      if (!item.lens) item.lens = 'review'
      if (!item.title) item.title = 'Review finding'
      if (!item.severity) item.severity = 'suggestion'
      item.confidence = asNumber(item.confidence, 0)
      if (!item.location) item.location = { path: 'PR' }
      if (!item.claim) item.claim = item.title
      if (!item.evidence) item.evidence = ''
      if (!item.whyItMatters) item.whyItMatters = ''
      if (!item.suggestedFix) item.suggestedFix = ''
      if (!item.existingReviewOverlap) {
        item.existingReviewOverlap = { status: 'none', threadId: '', rationale: '' }
      }
      if (!item.existingReviewOverlap.rationale) item.existingReviewOverlap.rationale = ''
      if (!item.sourceAgent) item.sourceAgent = ''
      nextId++
    })
  })
  if (!Array.isArray(finalBoard.positiveObservations)) finalBoard.positiveObservations = positives

  // These fields intentionally extend the synthesizer schema; the skill
  // presents them as part of the final review board contract.
  finalBoard.pr = prContext.pr
  finalBoard.summary = prContext.summary
  finalBoard.reviewMeta = {
    selectedReviewers: prContext.selectedReviewers,
    totalFindings: findings.length,
    existingThreadCount: prContext.threads.length,
    changedFileCount: prContext.summary.changedFileCount,
    collectedFileCount: prContext.summary.collectedFileCount,
    filePageCount: prContext.filePageCount,
    sources: prContext.sources || {
      manifestSource: 'mcp',
      patchSource: 'none',
      mergeCommit: '',
      baseSha: '',
      headSha: prContext.pr.headSha || '',
      fullDiffIncluded: false,
      fallbackReason: '',
      recoveryAttempts: 0,
      recoveredFileSlots: 0
    }
  }
  return finalBoard
}

phase('Collect')
log('Collecting PR metadata for ' + config.owner + '/' + config.repo + '#' + config.pullNumber)

const metadataPrompt = `Use GitHub read tools only. Fetch PR metadata with pull_request_read method get for ${config.owner}/${config.repo} PR #${config.pullNumber}. Return title, body, author login, base ref, head SHA, changed file count, additions, deletions, state, and review decision if available. Do not call any GitHub write tools.`

const prResult = await agent(metadataPrompt, {
  label: 'collect-pr-metadata',
  schema: PR_METADATA_SCHEMA,
  phase: 'Collect',
  agentType: GITHUB_COLLECTOR_AGENT_TYPE,
  model: 'haiku',
  effort: 'low'
})

const pr = normalizePr(prResult)

let files
let filePageCount
let manifestSource
let effectiveFullDiff = localGitManifest && localGitManifest.length > 0 ? fullDiff : null
let fallbackReason = (configSources && configSources.fallbackReason) || ''
let recoveryAttempts = 0
let recoveredFileSlots = 0

if (localGitManifest && localGitManifest.length > 0) {
  log('Using local git manifest with ' + localGitManifest.length + ' file(s)')
  files = localGitManifest.map(function(entry) {
    const category = entry.category || categorizePath(entry.path)
    return {
      path: entry.path,
      status: entry.status || 'modified',
      additions: asNumber(entry.additions, 0),
      deletions: asNumber(entry.deletions, 0),
      category: category,
      signals: signalsForFile({ path: entry.path, category: category, signals: entry.signals }),
      patchAvailable: Boolean(fullDiff),
      page: 0,
      perPage: 0,
      threadCount: 0
    }
  })
  filePageCount = 0
  manifestSource = 'local-git'

  if (pr.changedFiles && files.length !== pr.changedFiles) {
    fallbackReason = 'local git manifest count mismatch: expected ' + pr.changedFiles + ', got ' + files.length
    log('Warning: ' + fallbackReason + '. Falling back to GitHub MCP file collection.')
    const fileManifest = await collectCompleteFileManifest(pr)
    files = fileManifest.files
    filePageCount = fileManifest.pageCount
    manifestSource = 'mcp'
    effectiveFullDiff = null
    recoveryAttempts = asNumber(fileManifest.recoveryAttempts, 0)
    recoveredFileSlots = asNumber(fileManifest.recoveredFileSlots, 0)
  }
} else {
  const fileManifest = await collectCompleteFileManifest(pr)
  files = fileManifest.files
  filePageCount = fileManifest.pageCount
  manifestSource = 'mcp'
  recoveryAttempts = asNumber(fileManifest.recoveryAttempts, 0)
  recoveredFileSlots = asNumber(fileManifest.recoveredFileSlots, 0)
}
if (pr.changedFiles === 0) pr.changedFiles = files.length

log('Fetching review threads')
const threadPrompt = `Use GitHub read tools only. Fetch all review comment threads via pull_request_read method get_review_comments for ${pr.owner}/${pr.repo} PR #${pr.number}. Paginate if needed. Return compact thread records only: id (thread node id when available), commentId (the numeric comment ID from discussion_r anchors, as a number), path, line, author login of the first comment, body of the first comment, isResolved, and replies with author/body. Do not call any GitHub write tools.`

const threadData = await agent(threadPrompt, {
  label: 'collect-review-threads',
  schema: THREAD_SCHEMA,
  phase: 'Collect',
  agentType: GITHUB_COLLECTOR_AGENT_TYPE,
  model: 'haiku',
  effort: 'high'
})

const threads = (threadData && Array.isArray(threadData.threads)) ? threadData.threads : []
const summary = buildSummary(pr, files, threads)
const prContext = {
  pr: pr,
  files: files,
  threads: threads,
  summary: summary,
  filePageCount: filePageCount,
  fullDiff: effectiveFullDiff || null,
  sources: {
    manifestSource: manifestSource,
    patchSource: effectiveFullDiff ? 'local-git' : 'none',
    mergeCommit: (configSources && configSources.mergeCommit) || '',
    baseSha: (configSources && configSources.baseSha) || '',
    headSha: (configSources && configSources.headSha) || pr.headSha || '',
    fullDiffIncluded: Boolean(effectiveFullDiff),
    fallbackReason: fallbackReason,
    recoveryAttempts: recoveryAttempts,
    recoveredFileSlots: recoveredFileSlots
  }
}

phase('Analyze')
const selected = selectReviewers(files, summary)
prContext.selectedReviewers = selected
log('Running ' + selected.length + ' review agent(s): ' + selected.join(', '))

const results = await parallel(selected.map(name => () => {
  const reviewer = REVIEWERS[name]
  const overrides = reviewer.options || {}
  const opts = Object.assign(
    { label: name, schema: FINDING_SCHEMA, phase: 'Analyze', agentType: ANALYSIS_AGENT_TYPE, effort: 'high' },
    overrides
  )
  return agent(analysisPrompt(name, prContext), opts)
}))

let allFindings = []
const allPositive = []
selected.forEach((name, index) => {
  const reviewer = REVIEWERS[name]
  const result = results[index]
  if (!result) {
    log('Warning: ' + name + ' produced no findings (agent may have failed)')
    return
  }
  if (Array.isArray(result.findings)) {
    if (result.findings.length === 0) {
      log('Reviewer ' + name + ' (' + (reviewer.lens || name) + ') produced 0 findings')
    }
    allFindings.push(...result.findings.map(finding => Object.assign({}, finding, {
      lens: reviewer.lens || name,
      sourceAgent: name
    })))
  }
  if (Array.isArray(result.positiveObservations)) {
    allPositive.push(...result.positiveObservations)
  }
})
sortFindings(allFindings)

phase('Synthesize')
log('Synthesizing review board from ' + allFindings.length + ' finding(s)')

const synthesisInput = {
  pr: prContext.pr,
  summary: prContext.summary,
  threads: prContext.threads,
  findings: allFindings,
  positiveObservations: allPositive
}

const synthPrompt = `You are synthesizing a human-centered PR review board from specialist candidate findings.\n\nDo not call tools. Use only the JSON input below.\n\n${JSON.stringify(synthesisInput)}\n\nBuild a review board grouped by outcome:\n- recommendedToPost: high-signal findings that look postable by a human reviewer and are not already covered by existing review threads.\n- relatedToExisting: findings that overlap with an existing review thread — either as an endorsement or with additional detail beyond what the thread covers.\n- discussionOnly: useful reviewer notes that should not be posted as comments yet.\n- alreadyCovered: findings fully covered by existing human or bot review threads.\n- discarded: weak, low-confidence, duplicate, or not-actionable findings.\n\nSynthesis rules:\n1. Merge duplicate specialist findings by logical concern before assigning a section. Same concern means the same bug, risk, missing test, comment problem, or type-design issue, even when titles differ.\n2. Preserve specialist evidence and reasoning in the existing board fields, especially evidence, whyItMatters, suggestedFix, and existingReviewOverlap.rationale. When merging duplicates, combine non-redundant evidence rather than dropping it.\n3. Classify against existing review threads by logical concern, not just file proximity. Use existingReviewOverlap.status values none, overlaps, or already_covered.\n4. Use each specialist's postability recommendation as an input, not a command. Do not invent posting or drafting behavior.\n5. Include positive observations when useful.`

const synthesized = await agent(synthPrompt, {
  label: 'synthesize-review-board',
  schema: REVIEW_BOARD_SCHEMA,
  phase: 'Synthesize',
  agentType: ANALYSIS_AGENT_TYPE,
  model: 'opus',
  effort: 'high'
})

return finalizeBoard(synthesized, allFindings, allPositive, prContext)
