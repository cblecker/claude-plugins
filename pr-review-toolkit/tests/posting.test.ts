import { expect, test } from 'claude-code/testing'
import { buildPlan, emptyPlan, finishPosting, inDiff, planPosting, postingBlockers, postReview, startPosting, submittedEvent } from '../hooks/lib/posting'
import type { PostResult } from '../hooks/lib/posting'
import { acceptDrafts } from '../hooks/lib/drafting'
import type { Io, McpResult, ProcResult } from '../hooks/lib/io'
import type { Draft, PostingPlan, RunState } from '../hooks/lib/types'

const HEAD = 'abc1234'
const MB = 'b'.repeat(40)
const MOVED = 'The PR head moved since the review; re-run on the new head.'

// F1 and F2 are line findings in a.go; F3 overlaps thread 7 (resolved); P1 is the follow-up
// item on thread 9 (resolution unknown); F4 overlaps thread 9 too and P1 is its follow-up item.
const board: any = {
  recommendedToPost: [
    { id: 'F1', title: 't1', severity: 'important', confidence: 90, location: { path: 'a.go', line: 3 } },
    { id: 'F2', title: 't2', severity: 'suggestion', confidence: 80, location: { path: 'a.go', line: 40 } },
    { id: 'F3', title: 't3', severity: 'suggestion', confidence: 70, existingReviewOverlap: { status: 'overlaps', commentId: 7, isResolved: true, threadPath: 'b.go', threadLine: 5 } },
    { id: 'F4', title: 't4', severity: 'important', confidence: 85, followUpItemId: 'P1', existingReviewOverlap: { status: 'overlaps', commentId: 9, threadPath: 'c.go', threadLine: 12 } },
  ],
  discussionOnly: [], alreadyCovered: [], discarded: [],
  followUp: { items: [{ id: 'P1', commentId: 9, ask: 'x', status: 'partial', evidence: 'e', path: 'c.go', line: 12 }] },
}

const baseRun = {
  handle: 'o/r#1', phase: 'preview', warnings: [],
  pr: { owner: 'o', repo: 'r', number: 1, title: 't', body: 'b', author: 'a', state: 'open', baseRef: 'main', headSha: HEAD },
  checkoutPath: '/w', mergeBase: MB, baseAheadCount: 0, reviewerLogin: 'me',
  diff: { nameStatus: '', numstat: '', shortstat: '' },
  summary: { scale: 'small', notableAreas: [], shapeUnavailable: false },
  lenses: [], lensSource: 'selector',
  threads: [], threadCollectionFailed: false, reviews: [], reviewsCollectionFailed: false, followUp: null,
  deposits: {}, verdicts: null, board,
  selected: ['F1', 'F2', 'F4', 'P1'], drafts: [], event: 'COMMENT', posted: [],
} as unknown as RunState

const lineIn: Draft = { id: 'F1', kind: 'line', path: 'a.go', line: 3, body: 'in' }
const lineOut: Draft = { id: 'F2', kind: 'line', path: 'a.go', line: 40, body: 'out' }
const merged: Draft = { id: 'F4', kind: 'reply', commentId: 9, body: 'r', alsoCovers: ['P1'] }

const planned = (drafts: Draft[], hunks: Record<string, [number, number][] | null> = { 'a.go': [[1, 5]] }, over: Partial<RunState> = {}): RunState => {
  const run = { ...baseRun, ...over }
  return { ...run, drafts, plan: planPosting(run, drafts, hunks) }
}

// A GitHub stub: answers by `tool:method` key; a function answer gets the args, an Error is
// thrown (no answer from the server), { isError } is a refusal. Unlisted writes answer ok.
type Answer = unknown
function github(answers: Record<string, Answer> = {}) {
  const calls: { key: string; args: Record<string, unknown> }[] = []
  const io: Io = {
    run: async () => { throw new Error('unexpected git') },
    mcp: async (tool, args): Promise<McpResult> => {
      const key = typeof args.method === 'string' ? `${tool}:${args.method}` : tool
      calls.push({ key, args })
      const entry = key in answers ? answers[key] : key === 'pull_request_read:get' ? { head: { sha: HEAD } } : 'ok'
      const v = typeof entry === 'function' ? (entry as (a: Record<string, unknown>) => unknown)(args) : entry
      if (v instanceof Error) throw v
      if (v && typeof v === 'object' && 'isError' in v) return v as McpResult
      return { content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] }
    },
    complete: async () => { throw new Error('unexpected model call') },
  }
  return { io, calls, keys: () => calls.map((c) => c.key), call: (key: string) => calls.find((c) => c.key === key) }
}
const refused = (text: string): McpResult => ({ isError: true, content: [{ type: 'text', text }] })
const WRITES = ['add_reply_to_pull_request_comment', 'pull_request_review_write:create', 'add_comment_to_pending_review', 'pull_request_review_write:submit_pending', 'pull_request_review_write:delete_pending']
const wrote = (keys: string[]) => keys.filter((k) => WRITES.includes(k))

// ---- anchors and the plan ----

test('inDiff: a line inside any hunk, inclusive at both ends', () => {
  expect(inDiff([[1, 5], [20, 22]], 1)).toBe(true)
  expect(inDiff([[1, 5], [20, 22]], 5)).toBe(true)
  expect(inDiff([[1, 5], [20, 22]], 21)).toBe(true)
  expect(inDiff([[1, 5], [20, 22]], 6)).toBe(false)
  expect(inDiff([], 1)).toBe(false)
})

test('out-of-diff line drafts move to the review body', () => {
  const plan = planPosting(baseRun, [lineIn, lineOut, merged], { 'a.go': [[1, 5]] })
  expect(plan.lineComments.map((d) => d.id)).toEqual(['F1'])
  expect(plan.replies.map((d) => d.id)).toEqual(['F4'])
  expect(plan.body).toContain('out')
  expect(plan.body).toBe('`a.go:40`: out')
  expect(plan.moved).toEqual([{ id: 'F2', path: 'a.go', line: 40, reason: 'outside-diff' }])
  expect(plan.bodyCovers).toEqual(['F2'])
  expect(plan.lineComments[0]).toEqual({ id: 'F1', covers: ['F1'], path: 'a.go', line: 3, body: 'in' })
})

test('a line draft whose diff could not be read moves to the body too', () => {
  const plan = planPosting(baseRun, [lineIn, { id: 'F2', kind: 'line', path: 'z.go', line: 2, body: 'z' }], { 'a.go': null })
  expect(plan.lineComments).toEqual([])
  expect(plan.moved).toEqual([
    { id: 'F1', path: 'a.go', line: 3, reason: 'diff-unavailable' },
    { id: 'F2', path: 'z.go', line: 2, reason: 'diff-unavailable' },
  ])
  expect(plan.body).toBe('`a.go:3`: in\n\n`z.go:2`: z')
})

test('a path named like an Object property is not mistaken for hunks', () => {
  const plan = planPosting(baseRun, [{ id: 'F1', kind: 'line', path: 'constructor', line: 1, body: 'c' }], {})
  expect(plan.moved[0]!.reason).toBe('diff-unavailable')
})

test('the review body keeps draft order: body drafts as written, moved line drafts with their location', () => {
  const plan = planPosting({ ...baseRun, selected: ['F1', 'F2', 'F3'] }, [
    { id: 'F3', kind: 'body', body: 'overall\n' },
    lineOut,
    { id: 'F1', kind: 'line', path: 'we`ird.go', line: 3, body: 'tick' },
  ], { 'a.go': [[1, 5]], 'we`ird.go': [] })
  expect(plan.body).toBe('overall\n\n`a.go:40`: out\n\n`` we`ird.go:3 ``: tick')
  expect(plan.bodyCovers).toEqual(['F3', 'F2', 'F1'])
})

test('a reply carries its target, the ids it covers, and the thread it lands on', () => {
  const plan = planPosting({ ...baseRun, selected: ['F3', 'F4', 'P1'] }, [
    { id: 'F3', kind: 'reply', commentId: 7, body: 'r3' },
    merged,
  ], {})
  expect(plan.replies).toEqual([
    { id: 'F3', covers: ['F3'], commentId: 7, body: 'r3', threadPath: 'b.go', threadLine: 5, isResolved: true },
    // Resolution state unknown: isResolved is absent.
    { id: 'F4', covers: ['F4', 'P1'], commentId: 9, body: 'r', threadPath: 'c.go', threadLine: 12 },
  ])
  expect(plan.body).toBe('')
  expect(plan.headSha).toBe(HEAD)
  expect(plan.mergeBase).toBe(MB)
})

test('a body draft that merges a finding and its follow-up item covers both', () => {
  const plan = planPosting(baseRun, [{ id: 'F4', kind: 'body', body: 'both', alsoCovers: ['P1'] }], {})
  expect(plan.bodyCovers).toEqual(['F4', 'P1'])
  expect(plan.body).toBe('both')
})

test('drafts for items already posted are left out of a new plan', () => {
  const plan = planPosting({ ...baseRun, posted: ['P1'] }, [lineIn, merged], { 'a.go': [[1, 5]] })
  expect(plan.replies).toEqual([])
  expect(plan.alreadyPosted).toEqual(['F4', 'P1'])
  expect(plan.lineComments.map((c) => c.id)).toEqual(['F1'])
})

// ---- buildPlan: the hunks come from the pinned range, one diff per path ----

const diffOf = (path: string, header: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${header}\n`
function gitStub(answers: Record<string, ProcResult | Error>) {
  const runs: { argv: string[]; cwd?: string }[] = []
  const io: Io = {
    run: async (argv, opts) => {
      runs.push({ argv, cwd: opts?.cwd })
      const path = argv[argv.length - 1]!
      const a = answers[path]
      if (!a) throw new Error(`unexpected path ${path}`)
      if (a instanceof Error) throw a
      return a
    },
    mcp: async () => { throw new Error('unexpected GitHub call') },
    complete: async () => { throw new Error('unexpected model call') },
  }
  return { io, runs }
}
const ok = (stdout: string): ProcResult => ({ exitCode: 0, stdout, stderr: '' })

test('buildPlan diffs each line path once over the pinned range with default context', async () => {
  // Default context: the hunk spans the change and three lines either side (10..16).
  const body = ' c\n c\n c\n+x\n c\n c\n c\n'
  const g = gitStub({ 'a.go': ok(diffOf('a.go', '@@ -10,6 +10,7 @@') + body) })
  const plan = await buildPlan(g.io, baseRun, [
    { id: 'F1', kind: 'line', path: 'a.go', line: 10, body: 'context line' },
    { id: 'F2', kind: 'line', path: 'a.go', line: 40, body: 'far' },
    merged,
  ])
  expect(g.runs).toEqual([{
    argv: ['git', '-c', 'core.quotePath=false', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--no-color',
      '--src-prefix=a/', '--dst-prefix=b/', '-U3', '--inter-hunk-context=0', `${MB}..${HEAD}`, '--', 'a.go'],
    cwd: '/w',
  }])
  expect(plan.lineComments.map((c) => [c.id, c.line])).toEqual([['F1', 10]])
  expect(plan.moved).toEqual([{ id: 'F2', path: 'a.go', line: 40, reason: 'outside-diff' }])
  expect(plan.replies.map((r) => r.id)).toEqual(['F4'])
})

test('buildPlan: a truncated diff, a failing git, or a git that cannot run leaves the anchors unknown', async () => {
  const hunk = diffOf('a.go', '@@ -1,0 +1,5 @@') + '+1\n+2\n+3\n+4\n+5\n'
  const cases: ProcResult[] = [{ ...ok(hunk), truncated: true }, { exitCode: 128, stdout: '', stderr: 'fatal' }]
  for (const answer of cases) {
    const plan = await buildPlan(gitStub({ 'a.go': answer }).io, baseRun, [lineIn])
    expect(plan.moved).toEqual([{ id: 'F1', path: 'a.go', line: 3, reason: 'diff-unavailable' }])
  }
  const thrown = await buildPlan(gitStub({ 'a.go': new Error('spawn failed') }).io, baseRun, [lineIn])
  expect(thrown.moved[0]!.reason).toBe('diff-unavailable')
  // A file the diff does not touch is outside it.
  const untouched = await buildPlan(gitStub({ 'a.go': ok('') }).io, baseRun, [lineIn])
  expect(untouched.moved[0]!.reason).toBe('outside-diff')
})

test('buildPlan never runs git with a range that is not two commit SHAs', async () => {
  const g = gitStub({})
  const plan = await buildPlan(g.io, { ...baseRun, mergeBase: '--output=x' }, [lineIn])
  expect(g.runs).toEqual([])
  expect(plan.moved[0]!.reason).toBe('diff-unavailable')
})

// ---- posting ----

test('posts replies, then a pending review with comments, then submits', async () => {
  const run = planned([lineIn, lineOut, merged])
  const g = github()
  const out = await postReview(g.io, run)
  expect(g.keys()).toEqual(['pull_request_read:get', 'add_reply_to_pull_request_comment', 'pull_request_review_write:create', 'add_comment_to_pending_review', 'pull_request_review_write:submit_pending'])
  expect(out.error).toBeUndefined()
  expect(out.finished).toBe(true)
  // The reply covers the finding and its follow-up item; the review covers its line comment and the moved draft.
  expect(out.posted).toEqual(['F4', 'P1', 'F1', 'F2'])
  const where = { owner: 'o', repo: 'r', pullNumber: 1 }
  expect(g.call('pull_request_read:get')!.args).toEqual({ method: 'get', ...where })
  expect(g.call('add_reply_to_pull_request_comment')!.args).toEqual({ ...where, commentId: 9, body: 'r' })
  expect(g.call('pull_request_review_write:create')!.args).toEqual({ method: 'create', ...where, commitID: HEAD })
  expect(g.call('add_comment_to_pending_review')!.args).toEqual({ ...where, path: 'a.go', line: 3, side: 'RIGHT', subjectType: 'LINE', body: 'in' })
  expect(g.call('pull_request_review_write:submit_pending')!.args).toEqual({ method: 'submit_pending', ...where, event: 'COMMENT', body: '`a.go:40`: out' })
  expect(out.log.length).toBeGreaterThan(0)
})

test('a line comment outside the diff is posted in the review body, never as a line comment', async () => {
  const hunk = diffOf('a.go', '@@ -1,0 +1,5 @@') + '+1\n+2\n+3\n+4\n+5\n'
  const plan = await buildPlan(gitStub({ 'a.go': ok(hunk) }).io, baseRun, [lineOut])
  const g = github()
  const out = await postReview(g.io, { ...baseRun, selected: ['F2'], plan })
  expect(g.keys()).toEqual(['pull_request_read:get', 'pull_request_review_write:create'])
  expect(g.call('pull_request_review_write:create')!.args).toEqual({ method: 'create', owner: 'o', repo: 'r', pullNumber: 1, event: 'COMMENT', body: '`a.go:40`: out', commitID: HEAD })
  expect(out.posted).toEqual(['F2'])
})

test('a moved head stops posting before any write', async () => {
  const g = github({ 'pull_request_read:get': { head: { sha: 'fff9999' } } })
  const out = await postReview(g.io, planned([lineIn, merged]))
  expect(out).toEqual({ posted: [], error: MOVED, log: expect.any(Array), finished: false })
  expect(g.keys()).toEqual(['pull_request_read:get'])
})

test('a PR that cannot be re-read stops posting before any write', async () => {
  for (const answer of [refused('Not Found'), new Error('server gone'), 'not json']) {
    const g = github({ 'pull_request_read:get': answer })
    const out = await postReview(g.io, planned([lineIn, merged]))
    expect(out.error).toMatch(/^Could not re-read o\/r#1 before posting: .*Nothing was posted\.$/)
    expect(out.posted).toEqual([])
    expect(wrote(g.keys())).toEqual([])
  }
})

test('a failed reply stops before the review and names what posted', async () => {
  const run = planned([{ id: 'F3', kind: 'reply', commentId: 7, body: 'r3' }, merged, lineIn], undefined, { selected: ['F1', 'F3', 'F4', 'P1'] })
  const g = github({ add_reply_to_pull_request_comment: (a: Record<string, unknown>) => (a.commentId === 9 ? refused('Validation Failed') : 'ok') })
  const out = await postReview(g.io, run)
  expect(g.keys()).toEqual(['pull_request_read:get', 'add_reply_to_pull_request_comment', 'add_reply_to_pull_request_comment'])
  expect(out.posted).toEqual(['F3'])
  expect(out.finished).toBe(false)
  expect(out.error).toContain('Validation Failed')
  expect(out.error).toContain('F4')
  expect(out.error).toContain('Posted before the stop: the reply for F3.')
  expect(out.error).toContain('No review was submitted.')
})

test('a reply GitHub did not answer counts as posted, so it is never sent twice', async () => {
  const g = github({ add_reply_to_pull_request_comment: new Error('timeout') })
  const out = await postReview(g.io, planned([merged, lineIn]))
  expect(wrote(g.keys())).toEqual(['add_reply_to_pull_request_comment'])
  expect(out.posted).toEqual(['F4', 'P1'])
  expect(out.finished).toBe(false)
  expect(out.error).toContain('may have posted')
  expect(out.error).toContain('No review was submitted.')
})

test('a failed pending-review create deletes nothing: the pending review GitHub refused over may be the user\'s own', async () => {
  for (const answer of [refused('User can only have one pending review per pull request'), new Error('timeout')]) {
    const g = github({ 'pull_request_review_write:create': answer })
    const out = await postReview(g.io, planned([merged, lineIn]))
    expect(wrote(g.keys())).toEqual(['add_reply_to_pull_request_comment', 'pull_request_review_write:create'])
    expect(out.posted).toEqual(['F4', 'P1'])
    expect(out.finished).toBe(false)
    expect(out.error).toContain('Posted before the stop: the reply for F4, P1.')
    expect(out.error).toContain('submit or delete it there')
  }
})

test('a failed line comment deletes the pending review and names what posted', async () => {
  const g = github({ add_comment_to_pending_review: refused('line must be part of the diff') })
  const out = await postReview(g.io, planned([merged, lineIn]))
  expect(wrote(g.keys())).toEqual(['add_reply_to_pull_request_comment', 'pull_request_review_write:create', 'add_comment_to_pending_review', 'pull_request_review_write:delete_pending'])
  expect(g.call('pull_request_review_write:delete_pending')!.args).toEqual({ method: 'delete_pending', owner: 'o', repo: 'r', pullNumber: 1 })
  expect(out.posted).toEqual(['F4', 'P1'])
  expect(out.finished).toBe(false)
  expect(out.error).toContain('line must be part of the diff')
  expect(out.error).toContain('The pending review was deleted.')
  expect(out.error).toContain('Posted before the stop: the reply for F4, P1.')
})

test('a pending review that cannot be deleted is named in the error', async () => {
  const g = github({ add_comment_to_pending_review: refused('bad line'), 'pull_request_review_write:delete_pending': refused('nope') })
  const out = await postReview(g.io, planned([lineIn]))
  expect(out.posted).toEqual([])
  expect(out.error).toContain('The pending review could not be deleted (nope); delete it on GitHub.')
})

test('a refused submit deletes the pending review; nothing of the review is posted', async () => {
  const g = github({ 'pull_request_review_write:submit_pending': refused('Unprocessable') })
  const out = await postReview(g.io, planned([lineIn, lineOut]))
  expect(wrote(g.keys())).toEqual(['pull_request_review_write:create', 'add_comment_to_pending_review', 'pull_request_review_write:submit_pending', 'pull_request_review_write:delete_pending'])
  expect(out.posted).toEqual([])
  expect(out.finished).toBe(false)
  expect(out.error).toContain('Unprocessable')
  expect(out.error).toContain('The pending review was deleted.')
  expect(out.error).toContain('No review was submitted.')
})

test('an unanswered submit: a pending review still there was not submitted; a missing one may have been', async () => {
  const kept = github({ 'pull_request_review_write:submit_pending': new Error('timeout') })
  const a = await postReview(kept.io, planned([lineIn]))
  expect(wrote(kept.keys()).at(-1)).toBe('pull_request_review_write:delete_pending')
  expect(a.posted).toEqual([])
  expect(a.finished).toBe(false)

  const gone = github({ 'pull_request_review_write:submit_pending': new Error('timeout'), 'pull_request_review_write:delete_pending': refused('no pending review') })
  const b = await postReview(gone.io, planned([lineIn, lineOut]))
  expect(b.posted).toEqual(['F1', 'F2'])
  expect(b.finished).toBe(true)
  expect(b.error).toContain('may have been submitted')
})

test('posting skips everything already posted', async () => {
  const run = { ...planned([merged, lineIn]), posted: ['F4', 'P1'] }
  const g = github()
  const out = await postReview(g.io, run)
  expect(wrote(g.keys())).toEqual(['pull_request_review_write:create', 'add_comment_to_pending_review', 'pull_request_review_write:submit_pending'])
  expect(out.posted).toEqual(['F1'])
  expect(out.error).toBeUndefined()
})

test('a review that covers an item already posted is refused without a write', async () => {
  const run = { ...planned([lineIn, lineOut]), posted: ['F2'] }
  const g = github()
  const out = await postReview(g.io, run)
  expect(g.keys()).toEqual([])
  expect(out.error).toContain('F2')
})

test('Approve without comments: one create with the event and no body', async () => {
  const run = { ...baseRun, selected: [], event: 'APPROVE', plan: emptyPlan(baseRun) } as RunState
  const g = github()
  const out = await postReview(g.io, run)
  expect(g.keys()).toEqual(['pull_request_read:get', 'pull_request_review_write:create'])
  expect(g.call('pull_request_review_write:create')!.args).toEqual({ method: 'create', owner: 'o', repo: 'r', pullNumber: 1, event: 'APPROVE', commitID: HEAD })
  expect(out).toEqual({ posted: [], log: expect.any(Array), finished: true })
})

test('replies alone submit no review, whatever event is chosen', async () => {
  for (const event of ['COMMENT', 'REQUEST_CHANGES', null] as const) {
    const g = github()
    const out = await postReview(g.io, { ...planned([merged]), event })
    expect(g.keys()).toEqual(['pull_request_read:get', 'add_reply_to_pull_request_comment'])
    expect(out.posted).toEqual(['F4', 'P1'])
    expect(out.finished).toBe(true)
  }
})

test('a review with no answer to its create may have been submitted, so it is not sent again', async () => {
  const g = github({ 'pull_request_review_write:create': new Error('timeout') })
  const out = await postReview(g.io, { ...planned([{ id: 'F1', kind: 'body', body: 'b' }], {}, { selected: ['F1'] }) })
  expect(out.posted).toEqual(['F1'])
  expect(out.finished).toBe(true)
  expect(out.error).toContain('may have been submitted')
  const refusedCreate = github({ 'pull_request_review_write:create': refused('Unprocessable') })
  const r = await postReview(refusedCreate.io, { ...planned([{ id: 'F1', kind: 'body', body: 'b' }], {}, { selected: ['F1'] }) })
  expect(r.posted).toEqual([])
  expect(r.finished).toBe(false)
  expect(wrote(refusedCreate.keys())).toEqual(['pull_request_review_write:create'])
})

test('posting without an event for review content writes nothing', async () => {
  const g = github()
  const out = await postReview(g.io, { ...planned([lineIn]), event: null })
  expect(g.keys()).toEqual([])
  expect(out.error).toMatch(/review event/)
})

// ---- what will post, and what blocks posting ----

test('submittedEvent: the chosen event with review content; with none, only an approval', () => {
  expect(submittedEvent(planned([lineIn]))).toBe('COMMENT')
  expect(submittedEvent({ ...planned([lineIn]), event: null })).toBe(null)
  expect(submittedEvent(planned([merged]))).toBe(null)
  expect(submittedEvent({ ...planned([merged]), event: 'APPROVE' })).toBe('APPROVE')
  expect(submittedEvent({ ...baseRun, event: 'APPROVE', plan: emptyPlan(baseRun) } as RunState)).toBe('APPROVE')
  expect(submittedEvent(baseRun)).toBe(null)
})

test('postingBlockers names why the post button is off', () => {
  expect(postingBlockers(planned([lineIn, merged]))).toEqual([])
  expect(postingBlockers({ ...planned([lineIn]), event: null })).toEqual(['Choose a review event: line comments and review-body text post as a review.'])
  expect(postingBlockers({ ...planned([{ id: 'F1', kind: 'body', body: 'b' }]), event: null })).toHaveLength(1)
  // Replies alone need no event (no review is submitted).
  expect(postingBlockers({ ...planned([merged]), event: null })).toEqual([])
  expect(postingBlockers({ ...baseRun, event: 'APPROVE', plan: emptyPlan(baseRun) } as RunState)).toEqual([])
  expect(postingBlockers({ ...baseRun, event: 'COMMENT', plan: emptyPlan(baseRun) } as RunState)[0]).toMatch(/^Nothing to post/)
  expect(postingBlockers({ ...planned([merged]), posted: ['F4', 'P1'] })[0]).toMatch(/^Nothing to post/)
  expect(postingBlockers(baseRun)).toEqual(['No drafts are ready to post; draft the selected items first.'])
  expect(postingBlockers(null)).toEqual(['No review is open.'])
  expect(postingBlockers({ ...planned([lineIn]), phase: 'posting' })).toEqual(['The review is being posted.'])
  expect(postingBlockers({ ...planned([lineIn]), phase: 'done' })).toEqual(['This review has been posted.'])
  expect(postingBlockers({ ...planned([lineIn]), phase: 'board' })).toEqual(['Posting starts from the preview.'])
  const stale = planned([lineIn])
  expect(postingBlockers({ ...stale, pr: { ...stale.pr, headSha: 'fff9999' } })).toEqual(['The drafts were checked against another head or range; draft them again.'])
  expect(postingBlockers({ ...planned([lineIn, lineOut]), posted: ['F2'] })[0]).toMatch(/already posted: F2/)
})

test('startPosting claims a postable preview once; finishPosting records what posted', () => {
  const run = planned([merged, lineIn])
  const claim = startPosting({ ...run, error: 'old' })
  expect(claim.blockers).toEqual([])
  expect(claim.run!.phase).toBe('posting')
  expect('error' in claim.run!).toBe(false)
  // A second press finds it posting and changes nothing.
  const again = startPosting(claim.run)
  expect(again.blockers).toEqual(['The review is being posted.'])
  expect(again.run).toBe(claim.run)
  const blocked = { ...run, event: null }
  expect(startPosting(blocked).run).toBe(blocked)

  const ok: PostResult = { posted: ['F4', 'P1', 'F1'], log: [], finished: true }
  expect(finishPosting(claim.run, ok)).toMatchObject({ phase: 'done', posted: ['F4', 'P1', 'F1'] })
  const failed: PostResult = { posted: ['F4', 'P1'], error: 'boom', log: [], finished: false }
  // Posted items leave the selection: a reword drafts only what is still to post.
  expect(finishPosting(claim.run, failed)).toMatchObject({ phase: 'preview', error: 'boom', posted: ['F4', 'P1'], selected: ['F1', 'F2'] })
  const unknown: PostResult = { posted: ['F1'], error: 'maybe', log: [], finished: true }
  expect(finishPosting(claim.run, unknown)).toMatchObject({ phase: 'done', error: 'maybe' })
  // What posted is recorded whatever the phase, without duplicates.
  const moved = { ...claim.run!, phase: 'board' as const, posted: ['F4'] }
  expect(finishPosting(moved, failed)).toMatchObject({ phase: 'board', posted: ['F4', 'P1'] })
  expect(finishPosting(null, ok)).toBe(null)
})

test('after a partial post, a reword cannot tie the posted item to one still to post', () => {
  // P1's reply posted, F4's line comment did not (the review failed).
  const claimed = startPosting(planned([{ id: 'P1', kind: 'reply', commentId: 9, body: 'p' }, { id: 'F4', kind: 'line', path: 'a.go', line: 3, body: 'f' }], undefined, { selected: ['F4', 'P1'] })).run
  const after = finishPosting(claimed, { posted: ['P1'], error: 'review failed', log: [], finished: false })!
  expect(after.selected).toEqual(['F4'])
  // The model's merge of F4 with P1 is refused, so F4 is drafted on its own and posts.
  expect(acceptDrafts(after, [{ id: 'F4', kind: 'reply', commentId: 9, body: 'r', alsoCovers: ['P1'] }]).answer).toContain('alsoCovers names unknown id P1')
  const ok = acceptDrafts(after, [{ id: 'F4', kind: 'reply', commentId: 9, body: 'r' }])
  expect(ok.answer).toMatch(/^accepted/)
  const plan = planPosting(ok.run!, ok.run!.drafts, {})
  expect(plan.replies.map((r) => r.covers)).toEqual([['F4']])
  expect(plan.alreadyPosted).toEqual([])
})

test('emptyPlan is pinned to the run\'s head and posts nothing', () => {
  const plan: PostingPlan = emptyPlan(baseRun)
  expect(plan).toEqual({ headSha: HEAD, mergeBase: MB, replies: [], lineComments: [], body: '', bodyCovers: [], moved: [], alreadyPosted: [] })
})
