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
                enum: ['recommended_to_post', 'possible_plus_one', 'partial_overlap', 'discussion_only', 'already_covered', 'discard']
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
          enum: ['none', 'possible_plus_one', 'partial_overlap', 'already_covered']
        },
        threadId: { type: 'string' },
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
    possiblePlusOnes: {
      type: 'array',
      items: BOARD_ITEM_SCHEMA
    },
    partialOverlaps: {
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
    },
    actionPlan: {
      type: 'object',
      properties: {
        critical: {
          type: 'array',
          items: { type: 'string' }
        },
        important: {
          type: 'array',
          items: { type: 'string' }
        },
        suggestions: {
          type: 'array',
          items: { type: 'string' }
        },
        recommendedNextAction: { type: 'string' }
      },
      required: ['critical', 'important', 'suggestions', 'recommendedNextAction']
    },
    coverageSummary: {
      type: 'object',
      properties: {
        scope: { type: 'string' },
        largePrNotes: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['scope', 'largePrNotes']
    }
  },
  required: ['recommendedToPost', 'possiblePlusOnes', 'partialOverlaps', 'discussionOnly', 'alreadyCovered', 'discarded', 'positiveObservations', 'actionPlan', 'coverageSummary']
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

const STANDARDIZATION_SUFFIX = `Return only high-signal candidate findings. For each finding, provide a concise title, a concrete claim, structured evidence, specialist reasoning, why it matters, and a specific suggested fix when applicable. Include a postability recommendation for human review only: recommended_to_post, possible_plus_one, partial_overlap, discussion_only, already_covered, or discard. Preserve concrete evidence from patches, files, and existing threads; do not collapse reasoning into generic summaries. Use a neutral technical voice and do not reference yourself, your role, or your review methodology.`

const PAGE_SIZE = 100

const AGENT_OPTS = {
  'code-reviewer':         { model: 'opus', effort: 'max' },
  'silent-failure-hunter': { effort: 'high' },
  'pr-test-analyzer':      { effort: 'high' },
  'comment-analyzer':      { effort: 'high' },
  'type-design-analyzer':  { effort: 'high' }
}

const LENS_NAMES = {
  'code-reviewer': 'code',
  'silent-failure-hunter': 'error-handling',
  'pr-test-analyzer': 'tests',
  'comment-analyzer': 'comments',
  'type-design-analyzer': 'type-design'
}

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

function candidateLocation(finding) {
  const rawLocation = finding.location || {}
  const location = {
    path: firstString([rawLocation.path, finding.file, finding.path], 'PR')
  }
  const line = rawLocation.line != null ? rawLocation.line : finding.line
  if (line != null) location.line = asNumber(line, 0)
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
  const status = recommendation === 'possible_plus_one'
    ? 'possible_plus_one'
    : recommendation === 'partial_overlap'
      ? 'partial_overlap'
      : recommendation === 'already_covered'
        ? 'already_covered'
        : 'none'

  return {
    status: status,
    threadId: threadIds[0] || '',
    rationale: postability.rationale || 'No existing review overlap was classified.'
  }
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

function mergeFilePages(pageResults) {
  const byPath = {}
  ;(pageResults || []).filter(Boolean).forEach((pageResult, pageIndex) => {
    const page = asNumber(pageResult.page, pageIndex + 1)
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
        perPage: PAGE_SIZE,
        threadCount: 0
      }
    })
  })
  return Object.keys(byPath).sort().map(path => byPath[path])
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
    const explicit = config.agents.filter(name => typeof PROMPTS[name] === 'string')
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

  return uniq(selected).filter(name => typeof PROMPTS[name] === 'string')
}

function contextForPrompt(prContext) {
  return JSON.stringify({
    pr: prContext.pr,
    summary: prContext.summary,
    files: prContext.files,
    threads: prContext.threads
  })
}

function analysisPrompt(name, prContext) {
  return PROMPTS[name] + '\n\n' + STANDARDIZATION_SUFFIX + `\n\n## Shared PR context\n\nThe workflow already collected PR metadata, the complete changed-file manifest, and review threads. Use this shared context for whole-PR awareness and do not refetch PR metadata, the full file list, or review threads.\n\n${contextForPrompt(prContext)}\n\n## Focused patch access\n\nUse GitHub read tools only. Do not call any GitHub write tools. If you need raw patch details for a focused high-signal file, call pull_request_read with method get_files for that file's recorded page and perPage, then inspect only the matching file's patch. Avoid loading every page again.\n\n## Output\n\nReturn findings that are useful candidates for a human reviewer. Postability is only a recommendation to the synthesizer; do not post comments, draft comments, request changes, approve, resolve threads, or call any GitHub write tools. Include positive observations when they help the final review board.`
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
  const recommendedToPost = []
  const possiblePlusOnes = []
  const partialOverlaps = []
  const discussionOnly = []
  const alreadyCovered = []
  const discarded = []

  findings.forEach((finding, index) => {
    const item = boardItemFromFinding(finding, index)
    const recommendation = postabilityRecommendation(finding)
    if (recommendation === 'recommended_to_post') {
      recommendedToPost.push(item)
    } else if (recommendation === 'possible_plus_one') {
      possiblePlusOnes.push(item)
    } else if (recommendation === 'partial_overlap') {
      partialOverlaps.push(item)
    } else if (recommendation === 'discussion_only') {
      discussionOnly.push(item)
    } else if (recommendation === 'already_covered') {
      alreadyCovered.push(item)
    } else if (recommendation === 'discard') {
      discarded.push(item)
    } else if ((item.severity === 'critical' || item.severity === 'important') && item.confidence >= 80) {
      recommendedToPost.push(item)
    } else if (item.confidence >= 50) {
      discussionOnly.push(item)
    } else {
      discarded.push(item)
    }
  })

  return {
    recommendedToPost: recommendedToPost,
    possiblePlusOnes: possiblePlusOnes,
    partialOverlaps: partialOverlaps,
    discussionOnly: discussionOnly,
    alreadyCovered: alreadyCovered,
    discarded: discarded,
    positiveObservations: positives,
    actionPlan: {
      critical: recommendedToPost.filter(item => item.severity === 'critical').map(item => item.id + ': ' + item.title),
      important: recommendedToPost.filter(item => item.severity === 'important').map(item => item.id + ': ' + item.title),
      suggestions: discussionOnly.map(item => item.id + ': ' + item.title),
      recommendedNextAction: recommendedToPost.length > 0 ? 'review recommended postable findings' : 'review discussion-only findings'
    },
    coverageSummary: {
      scope: coverageScope(prContext),
      largePrNotes: largePrNotes(prContext)
    }
  }
}

function coverageScope(prContext) {
  const summary = prContext.summary || {}
  const categories = summary.categories || {}
  const categoryText = Object.keys(categories).sort().map(key => key + ': ' + categories[key]).join(', ')
  return 'Collected ' + (summary.collectedFileCount || 0) + ' changed file(s) across ' + (prContext.filePageCount || 0) + ' page(s), with ' + (summary.existingThreadCount || 0) + ' existing review thread(s). Categories: ' + (categoryText || 'none') + '.'
}

function largePrNotes(prContext) {
  const summary = prContext.summary || {}
  const notes = []
  if (summary.scale === 'large' || summary.scale === 'very_large') {
    notes.push('Large PR: reviewers received the complete manifest and focused detailed patch reads on high-signal files.')
  }
  const lowSignal = (summary.categories && ((summary.categories.vendor || 0) + (summary.categories.generated || 0) + (summary.categories.lockfile || 0))) || 0
  if (lowSignal > 0) notes.push(lowSignal + ' vendor/generated/lockfile file(s) were kept visible in the manifest but deprioritized for detailed review.')
  return notes
}

function finalizeBoard(board, findings, positives, prContext) {
  const finalBoard = board || fallbackBoard(findings, positives, prContext)
  const sections = ['recommendedToPost', 'possiblePlusOnes', 'partialOverlaps', 'discussionOnly', 'alreadyCovered', 'discarded']
  let nextId = 1
  sections.forEach(section => {
    if (!Array.isArray(finalBoard[section])) finalBoard[section] = []
    finalBoard[section].forEach(item => {
      if (!item.id) item.id = 'F' + nextId
      if (!item.location) item.location = { path: 'PR' }
      if (!item.existingReviewOverlap) {
        item.existingReviewOverlap = { status: 'none', threadId: '', rationale: '' }
      }
      nextId++
    })
  })
  if (!Array.isArray(finalBoard.positiveObservations)) finalBoard.positiveObservations = positives
  if (!finalBoard.actionPlan) {
    finalBoard.actionPlan = {
      critical: [],
      important: [],
      suggestions: [],
      recommendedNextAction: 'review board'
    }
  }
  if (!finalBoard.coverageSummary) {
    finalBoard.coverageSummary = {
      scope: coverageScope(prContext),
      largePrNotes: largePrNotes(prContext)
    }
  }

  finalBoard.pr = prContext.pr
  finalBoard.summary = prContext.summary
  finalBoard.reviewMeta = {
    selectedReviewers: prContext.selectedReviewers,
    totalFindings: findings.length,
    existingThreadCount: prContext.threads.length,
    changedFileCount: prContext.summary.changedFileCount,
    collectedFileCount: prContext.summary.collectedFileCount,
    filePageCount: prContext.filePageCount
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
  model: 'haiku',
  effort: 'low'
})

const pr = normalizePr(prResult)
const filePageCount = Math.max(1, Math.ceil((pr.changedFiles || 1) / PAGE_SIZE))
const filePages = []
for (let page = 1; page <= filePageCount; page++) filePages.push(page)

log('Fetching changed files across ' + filePageCount + ' page(s)')
const filePageResults = await parallel(filePages.map(page => () => {
  const prompt = `Use GitHub read tools only. Call pull_request_read with method get_files for ${pr.owner}/${pr.repo} PR #${pr.number}, page ${page}, perPage ${PAGE_SIZE}. Return exactly the files from this page. Do not fetch other pages. Do not include raw patches in the response. Map GitHub's filename field to path. Set patchAvailable to true when the API entry has a non-empty patch. Categorize each file and add compact signals from the path/status/patch metadata only. Do not call any GitHub write tools.`
  return agent(prompt, {
    label: 'collect-files-page-' + page,
    schema: FILE_PAGE_SCHEMA,
    phase: 'Collect',
    model: 'haiku',
    effort: 'low'
  })
}))

let files = mergeFilePages(filePageResults)
if (pr.changedFiles === 0) pr.changedFiles = files.length

log('Fetching review threads')
const threadPrompt = `Use GitHub read tools only. Fetch all review comment threads via pull_request_read method get_review_comments for ${pr.owner}/${pr.repo} PR #${pr.number}. Paginate if needed. Return compact thread records only: id (thread node id when available), path, line, author login of the first comment, body of the first comment, isResolved, and replies with author/body. Do not call any GitHub write tools.`

const threadData = await agent(threadPrompt, {
  label: 'collect-review-threads',
  schema: THREAD_SCHEMA,
  phase: 'Collect',
  model: 'haiku',
  effort: 'low'
})

const threads = (threadData && Array.isArray(threadData.threads)) ? threadData.threads : []
const summary = buildSummary(pr, files, threads)
const prContext = {
  pr: pr,
  files: files,
  threads: threads,
  summary: summary,
  filePageCount: filePageCount
}

phase('Analyze')
const selected = selectReviewers(files, summary)
prContext.selectedReviewers = selected
log('Running ' + selected.length + ' review agent(s): ' + selected.join(', '))

const results = await parallel(selected.map(name => () => {
  const overrides = AGENT_OPTS[name] || {}
  const opts = Object.assign(
    { label: name, schema: FINDING_SCHEMA, phase: 'Analyze', effort: 'high' },
    overrides
  )
  return agent(analysisPrompt(name, prContext), opts)
}))

let allFindings = []
const allPositive = []
selected.forEach((name, index) => {
  const result = results[index]
  if (!result) return
  if (Array.isArray(result.findings)) {
    allFindings.push(...result.findings.map(finding => Object.assign({}, finding, {
      lens: LENS_NAMES[name] || name,
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

const synthPrompt = `You are synthesizing a human-centered PR review board from specialist candidate findings.\n\nDo not call tools. Use only the JSON input below.\n\n${JSON.stringify(synthesisInput)}\n\nBuild a review board grouped by outcome:\n- recommendedToPost: high-signal findings that look postable by a human reviewer.\n- possiblePlusOnes: findings where an existing thread already raises the issue but an endorsement may help.\n- partialOverlaps: findings that add useful information beyond an existing thread.\n- discussionOnly: useful reviewer notes that should not be posted as comments yet.\n- alreadyCovered: findings fully covered by existing human or bot review threads.\n- discarded: weak, low-confidence, duplicate, or not-actionable findings.\n\nUse each specialist's postability recommendation as an input, not a command. Preserve specialist evidence and reasoning in the existing board fields, especially evidence, whyItMatters, suggestedFix, and existingReviewOverlap.rationale. Classify against existing review threads by logical concern, not just file proximity. Keep IDs stable and concise (F1, F2, ...). Include positive observations when useful. The action plan should be easy to scan: critical issues first, important issues next, optional suggestions last, and one recommended next action. The coverage summary must be honest about large-PR scope and low-signal areas.`

const synthesized = await agent(synthPrompt, {
  label: 'synthesize-review-board',
  schema: REVIEW_BOARD_SCHEMA,
  phase: 'Synthesize',
  model: 'opus',
  effort: 'high'
})

return finalizeBoard(synthesized, allFindings, allPositive, prContext)
