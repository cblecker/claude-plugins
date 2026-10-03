import { expect, test } from 'claude-code/testing'
import { buildBoard, demote, finalizeBoard, findItem, followUpBoard, followUpItems, promote, tooPicky } from '../hooks/lib/board'
import type { Board, Severity } from '../hooks/lib/types'

const f = (title: string, severity: Severity, confidence: number, lens = 'code-reviewer') => ({ location: { path: 'a.go', line: 1 }, severity, confidence, title, claim: 'c', evidence: 'e ' + title, whyItMatters: 'w', lens })
const ctx: any = { threads: [], followUp: null, followUpDelta: null, summary: {}, selectedReviewers: [], lensEffort: {}, failedReviewers: [], lensSelection: { source: 'selector' }, reviewerIsAuthor: false }
const at = (title: string, severity: Severity, confidence: number, path: string, line?: number) => ({ ...f(title, severity, confidence), location: line === undefined ? { path } : { path, line } })
const ids = (b: Board, s: 'recommendedToPost' | 'discussionOnly' | 'alreadyCovered' | 'discarded') => b[s].map((i) => i.id)
const titles = (b: Board, s: 'recommendedToPost' | 'discussionOnly' | 'alreadyCovered' | 'discarded') => b[s].map((i) => i.title)

const THREADS_FAILED = 'Existing review threads could not be collected, so overlap classification and verdicts on your earlier threads are unavailable, and recommended findings may duplicate existing comments.'
const REVIEWS_FAILED = 'Your submitted reviews could not be read, so asks made only in a review summary are not checked.'

// Brief tests (behavior parity with the workflow).

test('routes by severity/confidence without synthesis and numbers F ids in section order', () => {
  const b = finalizeBoard(null, [f('a', 'important', 90), f('b', 'suggestion', 60), f('c', 'important', 30)], [], { ...ctx, synthesisFailed: true })
  expect(b.recommendedToPost.map((i) => i.id)).toEqual(['F1'])
  expect(b.discussionOnly.map((i) => i.title)).toEqual(['b'])
  expect(b.discarded.map((i) => i.title)).toEqual(['c'])
})

test('merged groups keep the lead finding and join distinct evidence', () => {
  const b = finalizeBoard({ groups: [{ findings: [0, 1], section: 'recommendedToPost', title: 'T', claim: 'C' }], keepPositives: [] }, [f('a', 'important', 90), f('b', 'critical', 70, 'silent-failure-hunter')], [], ctx)
  expect(b.recommendedToPost[0]!.severity).toBe('critical')
  expect(String(b.recommendedToPost[0]!.evidence)).toContain('e a')
})

test('promote/demote/too picky move items between sections', () => {
  let b = finalizeBoard(null, [f('a', 'important', 90), f('b', 'suggestion', 60)], [], { ...ctx, synthesisFailed: true })
  b = promote(b, 'F2'); expect(b.recommendedToPost.map((i) => i.id)).toEqual(['F1', 'F2'])
  b = demote(b, 'F1'); expect(b.discussionOnly.map((i) => i.id)).toContain('F1')
  b = tooPicky(b); expect(b.recommendedToPost.every((i) => i.severity === 'critical' || (i as any).changedSinceLastReview === true)).toBe(true)
})

// Routing parity: thresholds of the workflow's baseSection.

test('merit routing: critical/important need confidence 80 to be recommended; under 50 is discarded', () => {
  const b = finalizeBoard(null, [
    f('imp80', 'important', 80), f('imp79', 'important', 79), f('crit80', 'critical', 80), f('crit79', 'critical', 79),
    f('sug95', 'suggestion', 95), f('imp50', 'important', 50), f('imp49', 'important', 49), f('crit0', 'critical', 0),
  ], [], { ...ctx, synthesisFailed: true })
  expect(titles(b, 'recommendedToPost')).toEqual(['crit80', 'imp80'])
  expect(titles(b, 'discussionOnly')).toEqual(['crit79', 'imp79', 'imp50', 'sug95'])
  expect(titles(b, 'discarded')).toEqual(['crit0', 'imp49'])
})

test('sections sort by severity then confidence and F ids run across sections in order', () => {
  const b = finalizeBoard(null, [f('s', 'suggestion', 90), f('i', 'important', 85), f('c', 'critical', 81), f('c2', 'critical', 99), f('low', 'important', 10)], [], { ...ctx, synthesisFailed: true })
  expect(titles(b, 'recommendedToPost')).toEqual(['c2', 'c', 'i'])
  expect(ids(b, 'recommendedToPost')).toEqual(['F1', 'F2', 'F3'])
  expect(ids(b, 'discussionOnly')).toEqual(['F4'])
  expect(ids(b, 'discarded')).toEqual(['F5'])
})

test('a synthesis section wins over merit, and a routing note survives only off Recommended', () => {
  const synth = { groups: [
    { findings: [0], section: 'discussionOnly', note: 'needs discussion' },
    { findings: [1], section: 'recommendedToPost', note: 'dropped on recommended' },
    { findings: [2], section: 'discarded', note: 'not actionable' },
  ], keepPositives: [] }
  const b = finalizeBoard(synth, [f('hi', 'critical', 95), f('lo', 'suggestion', 40), f('mid', 'important', 90)], [], ctx)
  expect(b.discussionOnly[0]).toMatchObject({ title: 'hi', routingNote: 'needs discussion' })
  expect(b.recommendedToPost[0]!.title).toBe('lo')
  expect(b.recommendedToPost[0]!.routingNote).toBeUndefined()
  expect(b.discarded[0]).toMatchObject({ title: 'mid', routingNote: 'not actionable' })
})

test('every finding lands once: dropped, repeated and invalid indexes fall back to merit routing', () => {
  const synth: any = { groups: [{ findings: [0, 0, 7, -1, 1.5], section: 'discussionOnly' }, { findings: [0], section: 'discarded' }, null, { section: 'discarded' }], keepPositives: [] }
  const b = finalizeBoard(synth, [f('a', 'critical', 95), f('b', 'important', 90), f('c', 'important', 10)], [], ctx)
  expect(titles(b, 'discussionOnly')).toEqual(['a'])
  expect(titles(b, 'recommendedToPost')).toEqual(['b'])
  expect(titles(b, 'discarded')).toEqual(['c'])
})

test('a lone finding keeps its own title and claim; a merged group takes the rewritten ones and joins distinct text', () => {
  const findings = [
    { ...f('one', 'important', 90), suggestedFix: 'fix it' },
    { ...f('two', 'important', 85, 'silent-failure-hunter'), evidence: 'e one', whyItMatters: 'w2', suggestedFix: '' },
    f('solo', 'important', 90),
  ]
  const b = finalizeBoard({ groups: [{ findings: [0, 1], section: 'recommendedToPost', title: 'T', claim: 'C' }, { findings: [2], section: 'recommendedToPost', title: 'X', claim: 'Y' }], keepPositives: [] }, findings, [], ctx)
  const merged = b.recommendedToPost.find((i) => i.title === 'T')!
  expect(merged).toMatchObject({ claim: 'C', lens: 'code-reviewer, silent-failure-hunter', evidence: 'e one', whyItMatters: 'w\n\nw2', suggestedFix: 'fix it' })
  const solo = b.recommendedToPost.find((i) => i.title === 'solo')!
  expect(solo.claim).toBe('c')
  expect('suggestedFix' in solo).toBe(false)
})

// Overlap with existing threads.

const threads = [
  { id: 'T1', commentId: 11, path: 'a.go', line: 5, author: 'bot', body: 'b', isResolved: false, replies: [] },
  { id: 'T2', commentId: 22, path: 'b.go', originalLine: 9, author: 'me', body: 'b', replies: [] },
]

test('already_covered with a real thread goes to alreadyCovered as a compact item carrying the thread identity', () => {
  const b = finalizeBoard({ groups: [{ findings: [0], section: 'alreadyCovered', overlap: { status: 'already_covered', threadId: 'T1', rationale: 'same ask' } }], keepPositives: [] }, [f('a', 'critical', 95)], [], { ...ctx, threads })
  expect(b.alreadyCovered).toEqual([{ id: 'F1', lens: 'code-reviewer', title: 'a', severity: 'critical', confidence: 95, location: { path: 'a.go', line: 1 }, claim: 'c',
    existingReviewOverlap: { status: 'already_covered', commentId: 11, isResolved: false, threadAuthor: 'bot', threadPath: 'a.go', threadLine: 5, rationale: 'same ask' } }])
})

test('already_covered naming no known thread drops the overlap and routes on merit', () => {
  const b = finalizeBoard({ groups: [
    { findings: [0], section: 'alreadyCovered', overlap: { status: 'already_covered', threadId: 'nope' } },
    { findings: [1], section: 'alreadyCovered' },
  ], keepPositives: [] }, [f('a', 'critical', 95), f('b', 'suggestion', 70)], [], { ...ctx, threads })
  expect(b.alreadyCovered).toEqual([])
  expect(b.recommendedToPost.map((i) => [i.title, i.existingReviewOverlap])).toEqual([['a', undefined]])
  expect(titles(b, 'discussionOnly')).toEqual(['b'])
})

test('overlaps keeps the status as an annotation; an unknown thread carries no reply target; line falls back to originalLine', () => {
  const b = finalizeBoard({ groups: [
    { findings: [0], section: 'recommendedToPost', overlap: { status: 'overlaps', threadId: 'T2', rationale: 'adds detail' } },
    { findings: [1], section: 'recommendedToPost', overlap: { status: 'overlaps', threadId: 'gone' } },
    { findings: [2], section: 'recommendedToPost', overlap: { status: 'none', threadId: 'T1' } },
  ], keepPositives: [] }, [f('a', 'critical', 99), f('b', 'critical', 98), f('c', 'critical', 97)], [], { ...ctx, threads })
  const [a, bb, c] = b.recommendedToPost
  expect(a!.existingReviewOverlap).toEqual({ status: 'overlaps', commentId: 22, threadAuthor: 'me', threadPath: 'b.go', threadLine: 9, rationale: 'adds detail' })
  expect(a!.existingReviewOverlap!.isResolved).toBeUndefined()
  expect(bb!.existingReviewOverlap).toEqual({ status: 'overlaps' })
  expect(c!.existingReviewOverlap).toBeUndefined()
})

test('an overlap on one of your own threads cross-references its follow-up item and drops the thread id', () => {
  const followUp: any = { reviewedCommit: 'abcdef1234', items: [{ id: 'P1', threadId: 'T2', ask: 'x', status: 'partial', evidence: 'e' }] }
  const b = finalizeBoard({ groups: [{ findings: [0], section: 'recommendedToPost', overlap: { status: 'overlaps', threadId: 'T2' } }], keepPositives: [] }, [f('a', 'critical', 99)], [], { ...ctx, threads, followUp })
  const item = b.recommendedToPost[0]!
  expect(item.followUpItemId).toBe('P1')
  expect('threadId' in item.existingReviewOverlap!).toBe(false)
  expect(b.followUp).toBe(followUp)
})

test('Not posting items keep only the summary fields', () => {
  const b = finalizeBoard(null, [{ ...f('low', 'important', 10), suggestedFix: 'x' }], [], { ...ctx, synthesisFailed: true })
  expect(Object.keys(b.discarded[0]!).sort()).toEqual(['claim', 'confidence', 'id', 'lens', 'location', 'severity', 'title'])
})

// Follow-up delta routing.

const fu: any = { reviewedCommit: 'abcdef1234567', items: [] }
const delta = { available: true, commitsSince: 2, files: [{ path: 'a.go', hunks: [[10, 20]] }, { path: 'c.go', hunks: [] }] }

test('unchanged code since your review demotes a non-critical recommendation with the reason; critical stays', () => {
  const b = finalizeBoard(null, [at('imp', 'important', 90, 'a.go', 1), at('crit', 'critical', 90, 'a.go', 2)], [], { ...ctx, synthesisFailed: true, followUp: fu, followUpDelta: delta })
  expect(b.recommendedToPost.map((i) => [i.title, i.changedSinceLastReview])).toEqual([['crit', false]])
  expect(b.discussionOnly[0]).toMatchObject({ title: 'imp', changedSinceLastReview: false, routingNote: 'Code unchanged since your review at abcdef1.' })
})

test('changed-since-review: line in a hunk, file without a line, file absent, PR-wide, no delta', () => {
  const findings = [at('in', 'important', 90, 'a.go', 15), at('edge', 'important', 89, 'a.go', 20), at('nohunks', 'important', 88, 'c.go', 3), at('noline', 'important', 87, 'a.go'), at('absent', 'suggestion', 60, 'b.go', 1), at('pr', 'suggestion', 59, 'PR')]
  const b = finalizeBoard(null, findings, [], { ...ctx, synthesisFailed: true, followUp: fu, followUpDelta: delta })
  const changed = Object.fromEntries([...b.recommendedToPost, ...b.discussionOnly].map((i) => [i.title, i.changedSinceLastReview]))
  expect(changed).toEqual({ in: true, edge: true, nohunks: true, noline: true, absent: false, pr: undefined })
  const none = finalizeBoard(null, [at('in', 'important', 90, 'a.go', 1)], [], { ...ctx, synthesisFailed: true, followUp: fu, followUpDelta: null })
  expect('changedSinceLastReview' in none.recommendedToPost[0]!).toBe(false)
  const off = finalizeBoard(null, [at('in', 'important', 90, 'a.go', 1)], [], { ...ctx, synthesisFailed: true, followUp: null, followUpDelta: delta })
  expect('changedSinceLastReview' in off.recommendedToPost[0]!).toBe(false)
})

test('a merged concern is changed when any member is, unchanged only when every member is', () => {
  const findings = [at('a', 'important', 90, 'a.go', 1), at('b', 'important', 90, 'a.go', 12), at('c', 'important', 90, 'b.go', 1), at('d', 'important', 90, 'PR')]
  const synth = { groups: [{ findings: [0, 1], section: 'recommendedToPost', title: 'AB', claim: 'x' }, { findings: [2, 3], section: 'recommendedToPost', title: 'CD', claim: 'y' }], keepPositives: [] }
  const b = finalizeBoard(synth, findings, [], { ...ctx, followUp: fu, followUpDelta: delta })
  expect(b.recommendedToPost.map((i) => [i.title, i.changedSinceLastReview])).toEqual([['AB', true], ['CD', undefined]])
})

// Positives, warnings, meta.

test('positives: all distinct without synthesis; by valid index, deduped, with it', () => {
  expect(finalizeBoard(null, [], ['p', 'q', 'p', ''], ctx).positiveObservations).toEqual(['p', 'q'])
  const synth: any = { groups: [], keepPositives: [2, 1, 1, 9, -1, 0.5, 0] }
  expect(finalizeBoard(synth, [], ['p', 'q', 'r'], ctx).positiveObservations).toEqual(['r', 'q', 'p'])
})

test('warnings: prepare-time warnings first, flag sentences after, nothing said twice', () => {
  const b = finalizeBoard(null, [f('a', 'important', 90)], [], {
    ...ctx, warnings: ['Uncommitted changes are present; file reads see them, the diff does not.', THREADS_FAILED],
    lensSelection: { source: 'all-lenses-fallback' }, failedReviewers: ['pr-test-analyzer', 'type-design-analyzer'],
    threadCollectionFailed: true, synthesisFailed: true, reviewsCollectionFailed: true, reviewerIsAuthor: true,
  })
  expect(b.reviewMeta.warnings).toEqual([
    'Uncommitted changes are present; file reads see them, the diff does not.',
    THREADS_FAILED,
    'The lens selector returned invalid output, so every lens ran.',
    'pr-test-analyzer, type-design-analyzer did not complete, so the board is missing that coverage and the review is narrower than the reviewer list suggests.',
    'The synthesis step did not complete, so duplicate findings from different lenses are listed separately, overlap with existing threads was not checked, and sections come from severity and confidence alone.',
    REVIEWS_FAILED,
    'You opened this PR, so your own threads and comments are author notes and follow-up mode is off.',
  ])
})

test('a partial read is not reported as a failed one', () => {
  const b = finalizeBoard(null, [], [], { ...ctx, threads, threadCollectionFailed: true, reviewsCollectionFailed: true, reviewCount: 2,
    warnings: ['Review threads may be incomplete.', 'Your earlier reviews could not be read completely.'] })
  expect(b.reviewMeta.warnings).toEqual(['Review threads may be incomplete.', 'Your earlier reviews could not be read completely.'])
  expect(b.reviewMeta.threadCollectionFailed).toBe(true)
  expect(b.reviewMeta.reviewsCollectionFailed).toBe(true)
})

test('follow-up warnings: verifier failure first, else an unknown delta for a known reviewed commit', () => {
  const w = (followUp: any) => finalizeBoard(null, [], [], { ...ctx, followUp }).reviewMeta.warnings
  expect(w({ reviewedCommit: 'abc1234', deltaAvailable: false, verifierFailed: true, items: [] })).toEqual(['The follow-up verifier did not complete, so every thread is unverifiable and review-summary asks were not checked.'])
  expect(w({ reviewedCommit: 'abc1234', deltaAvailable: false, verifierFailed: false, items: [] })).toEqual(['What changed since your review could not be determined (usually because the branch was rewritten), so follow-up verdicts rest on the current code only.'])
  expect(w({ reviewedCommit: '', deltaAvailable: false, verifierFailed: false, items: [] })).toEqual([])
  expect(w({ reviewedCommit: 'abc1234', deltaAvailable: true, verifierFailed: false, items: [] })).toEqual([])
})

test('reviewMeta carries the run facts and the board carries summary and follow-up', () => {
  const summary = { scale: 'small', notableAreas: ['hooks'], shapeUnavailable: false }
  const b = finalizeBoard(null, [], [], { ...ctx, summary, selectedReviewers: ['code-reviewer'], lensEffort: { 'code-reviewer': 'high' }, lensSelection: { source: 'selector', rationales: { 'code-reviewer': 'always' } } })
  expect(b.summary).toBe(summary)
  expect(b.followUp).toBe(null)
  expect(b.reviewMeta).toEqual({ warnings: [], reviewerIsAuthor: false, selectedReviewers: ['code-reviewer'], lensEffort: { 'code-reviewer': 'high' }, failedReviewers: [],
    lensSelection: { source: 'selector', rationales: { 'code-reviewer': 'always' } }, threadCollectionFailed: false, reviewsCollectionFailed: false, synthesisFailed: false })
})

// Follow-up items (port of applyFollowUpVerdict, without the delta).

const mine = [
  { id: 'T1', commentId: 7, path: 'a.go', originalLine: 4, author: 'me', body: 'Please rename this.\nMore text', isResolved: true, isOutdated: true, replies: [] },
  { id: 'T2', path: 'b.go', line: 9, author: 'me', body: 'b2', replies: [] },
]

test('follow-up items: thread order from the collector, verdicts by thread id, summary asks after, P ids once', () => {
  const items = followUpItems({ verifierFailed: false }, mine, [
    { ask: 'Add a test', status: 'not_addressed', evidence: 'none yet' },
    { threadId: 'T2', ask: 'fix b', status: 'partial', evidence: 'half', fixedIn: 'abc1234' },
    { threadId: 'T9', ask: 'stray', status: 'addressed', evidence: 'x' },
  ])
  expect(items).toEqual([
    { id: 'P1', threadId: 'T1', commentId: 7, path: 'a.go', line: 4, isResolved: true, isOutdated: true, ask: 'Please rename this.', status: 'unverifiable', evidence: 'The verifier returned no verdict for this thread.' },
    { id: 'P2', threadId: 'T2', path: 'b.go', line: 9, ask: 'fix b', status: 'partial', evidence: 'half', fixedIn: 'abc1234' },
    { id: 'P3', ask: 'Add a test', status: 'not_addressed', evidence: 'none yet' },
  ])
  expect(items[1]!.isResolved).toBeUndefined()
})

test('follow-up items when the verifier failed: every thread unverifiable, no summary asks', () => {
  const items = followUpItems({ verifierFailed: true }, mine, null)
  expect(items.map((i) => [i.id, i.status, i.evidence])).toEqual([
    ['P1', 'unverifiable', 'The follow-up verifier did not complete.'],
    ['P2', 'unverifiable', 'The follow-up verifier did not complete.'],
  ])
  expect(items[0]!.ask).toBe('Please rename this.')
  expect(followUpItems({ verifierFailed: false }, [], null)).toEqual([])
})

test('a long thread body gives a one-line ask of at most 160 chars', () => {
  const [item] = followUpItems({ verifierFailed: false }, [{ id: 'T', path: 'a', author: 'me', body: 'x'.repeat(300), replies: [] }], [])
  expect(item!.ask).toBe('x'.repeat(160))
})

test('followUpBoard: the delta counts only when available with a file list', () => {
  const base: any = { reviewedCommit: 'abc1234', reviewedAt: '2026-01-01T00:00:00Z', reviewState: 'COMMENTED', threads: mine, reviewSummaries: [] }
  const ok = followUpBoard({ ...base, delta: { available: true, commitsSince: 3, files: [] } }, [], false)
  expect({ ...ok, items: ok.items.length }).toEqual({ reviewedCommit: 'abc1234', reviewedAt: '2026-01-01T00:00:00Z', reviewState: 'COMMENTED', threadCount: 2, deltaAvailable: true, commitsSince: 3, verifierFailed: false, items: 2 })
  expect(followUpBoard({ ...base, delta: { available: true, commitsSince: 3 } }, [], false).deltaAvailable).toBe(false)
  expect(followUpBoard({ ...base, delta: { available: false } }, [], false).commitsSince).toBeUndefined()
  expect(followUpBoard({ ...base, reviewedCommit: '', delta: { available: true, files: [] } }, [], false).deltaAvailable).toBe(false)
  expect(followUpBoard({ ...base, delta: { available: false } }, null, true).verifierFailed).toBe(true)
})

// The board for a finished run.

test('buildBoard assembles the context from the run', () => {
  const run: any = {
    pr: { author: 'Me' }, reviewerLogin: 'me', warnings: ['w0'], summary: { scale: 'small', notableAreas: [], shapeUnavailable: false },
    lenses: [{ name: 'code-reviewer', effort: 'high', rationale: 'always' }, { name: 'comment-analyzer', effort: 'medium', rationale: 'docs' }], lensSource: 'selector',
    threads: [], threadCollectionFailed: false, reviews: [], reviewsCollectionFailed: false,
    followUp: { reviewedCommit: 'abcdef1234', reviewedAt: '', reviewState: 'APPROVED', threads: mine, reviewSummaries: [], delta: { available: true, commitsSince: 1, files: [{ path: 'a.go', hunks: [[50, 60]] }] } },
    verdicts: null, failedLenses: ['comment-analyzer'], verifierFailed: true,
  }
  const b = buildBoard(run, { synthesized: null, findings: [at('imp', 'important', 90, 'a.go', 1)], positives: ['nice'] })
  expect(b.reviewMeta).toMatchObject({ reviewerIsAuthor: true, selectedReviewers: ['code-reviewer', 'comment-analyzer'], lensEffort: { 'code-reviewer': 'high', 'comment-analyzer': 'medium' },
    failedReviewers: ['comment-analyzer'], lensSelection: { source: 'selector', rationales: { 'code-reviewer': 'always', 'comment-analyzer': 'docs' } }, synthesisFailed: true })
  expect(b.reviewMeta.warnings[0]).toBe('w0')
  expect(b.followUp).toMatchObject({ reviewedCommit: 'abcdef1234', threadCount: 2, deltaAvailable: true, commitsSince: 1, verifierFailed: true })
  expect(b.followUp!.items.map((i) => i.id)).toEqual(['P1', 'P2'])
  expect(b.discussionOnly[0]).toMatchObject({ title: 'imp', changedSinceLastReview: false })
  expect(b.positiveObservations).toEqual(['nice'])
  expect(buildBoard({ ...run, reviewerLogin: '' }, { synthesized: null, findings: [], positives: [] }).reviewMeta.synthesisFailed).toBe(false)
  expect(buildBoard({ ...run, reviewerLogin: '' }, { synthesized: null, findings: [], positives: [] }).reviewMeta.reviewerIsAuthor).toBe(false)
  const fallback = { ...run, lensSource: 'all-lenses-fallback', lenses: run.lenses.map((l: any) => ({ ...l, rationale: '' })) }
  expect(buildBoard(fallback, { synthesized: null, findings: [], positives: [] }).reviewMeta.lensSelection).toEqual({ source: 'all-lenses-fallback', rationales: {} })
})

// Board edits.

test('findItem, and edits that do nothing return the same board', () => {
  const b = finalizeBoard(null, [f('a', 'important', 90), f('b', 'suggestion', 60), f('c', 'important', 10)], [], { ...ctx, synthesisFailed: true })
  expect(findItem(b, 'F3')).toEqual({ section: 'discarded', index: 0 })
  expect(findItem(b, 'F9')).toBe(null)
  expect(promote(b, 'F1')).toBe(b)
  expect(demote(b, 'F9')).toBe(b)
})

test('edits do not mutate the board they are given', () => {
  const b = finalizeBoard(null, [f('a', 'important', 90), f('b', 'suggestion', 60), f('c', 'important', 10)], [], { ...ctx, synthesisFailed: true })
  const promoted = promote(b, 'F3')
  expect(ids(b, 'discarded')).toEqual(['F3'])
  expect(ids(promoted, 'recommendedToPost')).toEqual(['F1', 'F3'])
  expect(ids(promoted, 'discarded')).toEqual([])
})

test('too picky demotes every non-critical recommendation not changed since your review, with a note', () => {
  const b = finalizeBoard({ groups: [
    { findings: [0], section: 'recommendedToPost' }, { findings: [1], section: 'recommendedToPost' },
    { findings: [2], section: 'recommendedToPost' }, { findings: [3], section: 'recommendedToPost' },
  ], keepPositives: [] }, [at('crit', 'critical', 90, 'a.go', 1), at('changed', 'important', 90, 'a.go', 15), at('plain', 'suggestion', 90, 'b.go', 1), at('pr', 'important', 80, 'PR')], [], { ...ctx, followUp: fu, followUpDelta: delta })
  // 'plain' is unchanged and non-critical, so routing already demoted it.
  expect(titles(b, 'recommendedToPost')).toEqual(['crit', 'changed', 'pr'])
  const t = tooPicky(b)
  expect(titles(t, 'recommendedToPost')).toEqual(['crit', 'changed'])
  expect(t.discussionOnly.find((i) => i.title === 'pr')!.routingNote).toBe('Demoted at your request.')
})
