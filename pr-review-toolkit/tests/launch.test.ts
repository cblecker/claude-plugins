import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { BY_NAME_ONLY, inFlightError, launchedTaskId, launchFieldsError, launchGate, newNonce } from '../hooks/lib/launch'
import type { FollowUpContext, RunState } from '../hooks/lib/types'
import { world } from './world'

const summary = { scale: 'small', changedFileCount: 1, additions: 2, deletions: 0, notableAreas: ['a.go'], shapeUnavailable: false }
const run: RunState = {
  handle: 'o/r#1', phase: 'progress', warnings: [],
  pr: { owner: 'o', repo: 'r', number: 1, title: 't', body: 'b', author: 'a', state: 'open', baseRef: 'main', headSha: 'abc1234', mergeableState: 'clean', baseRepo: 'o/r' },
  checkoutPath: '/w', mergeBase: 'def5678', baseAheadCount: 0, reviewerLogin: 'me',
  diff: { nameStatus: '', numstat: '', shortstat: '' }, summary,
  lenses: [{ name: 'code-reviewer', effort: 'high', rationale: '' }], lensSource: 'selector',
  threads: [], threadCollectionFailed: false, reviews: [], reviewsCollectionFailed: false, followUp: null,
  deposits: {}, verdicts: null, selected: [], drafts: [], event: null, posted: [],
}
const denial = (g: ReturnType<typeof launchGate>): string => ('deny' in g ? g.deny : '')

test('denies without preflight, for another PR, after HEAD moved, or while a run is in flight', () => {
  expect(launchGate(null, { pr: 'o/r#1' }, 'abc1234', 1)).toEqual({ deny: expect.stringMatching(/prepare_review/) })
  expect('deny' in launchGate(run, { pr: 'o/r#2' }, 'abc1234', 1)).toBe(true)
  expect('deny' in launchGate(run, { pr: 'o/r#1' }, 'fff9999', 1)).toBe(true)
  expect('deny' in launchGate({ ...run, taskId: 't1' }, { pr: 'o/r#1' }, 'abc1234', 1)).toBe(true)
})

test('a run in flight is named, and it wins over a stale handle', () => {
  const busy = { ...run, run: 'rx', taskId: 't1' }
  expect(denial(launchGate(busy, { pr: 'o/r#1' }, 'abc1234', 1))).toBe('A review run is already in progress for o/r#1; cancel it in the review pane first.')
  expect(denial(launchGate(busy, { pr: 'o/r#2' }, 'abc1234', 1))).toMatch(/already in progress for o\/r#1/)
})

test('a preparation launches once: a finished run or a pending launch is "already used"', () => {
  const used = denial(launchGate({ ...run, run: 'rx', taskId: 't1', phase: 'board' }, { pr: 'o/r#1' }, 'abc1234', 1))
  expect(used).toMatch(/already used/)
  expect(used).toMatch(/prepare_review/)
  // A nonce without a taskId: another launch claimed this preparation and has not returned yet.
  expect(denial(launchGate({ ...run, run: 'rx' }, { pr: 'o/r#1' }, 'abc1234', 1))).toMatch(/already used/)
})

test('the deny reasons name the prepared PR and both heads', () => {
  expect(denial(launchGate(run, { pr: 'o/r#2' }, 'abc1234', 1))).toBe('This review was prepared for o/r#1, not o/r#2. Run prepare_review again.')
  expect(denial(launchGate(run, {}, 'abc1234', 1))).toMatch(/args\.pr.*o\/r#1/)
  expect(denial(launchGate(run, undefined, 'abc1234', 1))).toMatch(/args\.pr/)
  const moved = denial(launchGate(run, { pr: 'o/r#1' }, 'fff9999', 1))
  expect(moved).toMatch(/fff9999/)
  expect(moved).toMatch(/abc1234/)
  expect(moved).toMatch(/prepare_review/)
})

test('an unreadable HEAD is denied as unreadable, not as moved', () => {
  const d = denial(launchGate(run, { pr: 'o/r#1' }, '', 1))
  expect(d).toMatch(/Could not read HEAD in \/w/)
})

test('builds the full payload with a nonce', () => {
  const out: any = launchGate(run, { pr: 'o/r#1' }, 'abc1234', 1700000000000)
  expect(out.args.run).toBe(out.nonce)
  expect(out.args.lenses).toEqual([{ name: 'code-reviewer', effort: 'high' }])
  expect(out.args.pr.headSha).toBe('abc1234')
  expect(out).toEqual({
    nonce: newNonce(1700000000000),
    args: {
      run: newNonce(1700000000000),
      pr: { owner: 'o', repo: 'r', number: 1, title: 't', body: 'b', author: 'a', baseRef: 'main', headSha: 'abc1234' },
      checkoutPath: '/w', mergeBase: 'def5678', shape: summary,
      lenses: [{ name: 'code-reviewer', effort: 'high' }],
      followUp: null,
    },
  })
})

test('the payload carries the follow-up context as prepared', () => {
  const followUp: FollowUpContext = {
    reviewedCommit: 'abc0000', reviewedAt: '2026-01-01T00:00:00Z', reviewState: 'CHANGES_REQUESTED',
    threads: [{ id: 't1', path: 'a.go', line: 3, author: 'me', body: 'ask', replies: [] }],
    reviewSummaries: [{ state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01T00:00:00Z', body: 'fix' }],
    delta: { available: true, commitsSince: 1, files: [{ path: 'a.go', hunks: [[3, 3]] }] },
  }
  const out: any = launchGate({ ...run, followUp }, { pr: 'o/r#1' }, 'abc1234', 1)
  expect(out.args.followUp).toEqual(followUp)
})

test('newNonce is r plus the time in base 36', () => {
  expect(newNonce(1700000000000)).toBe('r' + (1700000000000).toString(36))
  expect(newNonce(35)).toBe('rz')
})

test('inFlightError: only a launched run still in progress is in flight', () => {
  expect(inFlightError(null)).toBe(null)
  expect(inFlightError(run)).toBe(null)
  expect(inFlightError({ ...run, run: 'rx' })).toBe(null)
  expect(inFlightError({ ...run, run: 'rx', taskId: 't1', phase: 'board' })).toBe(null)
  expect(inFlightError({ ...run, run: 'rx', taskId: 't1' })).toBe('A review run is already in progress for o/r#1; cancel it in the review pane first.')
})

test('inFlightError: a review being posted is in flight too', () => {
  const posting = 'The review of o/r#1 is being posted; wait for posting to finish.'
  expect(inFlightError({ ...run, run: 'rx', taskId: 't1', phase: 'posting' })).toBe(posting)
  expect(inFlightError({ ...run, phase: 'posting' })).toBe(posting)
  expect(denial(launchGate({ ...run, run: 'rx', taskId: 't1', phase: 'posting' }, { pr: 'o/r#1' }, 'abc1234', 1))).toBe(posting)
  for (const phase of ['preview', 'done'] as const) expect(inFlightError({ ...run, run: 'rx', taskId: 't1', phase })).toBe(null)
})

// ---- what the launch hook makes of the Workflow call and its answer ----

test('launchFieldsError: the review workflow launches by name only', () => {
  expect(BY_NAME_ONLY).toBe('Launch the review workflow by name only.')
  expect(launchFieldsError({ name: 'pr-review-toolkit:review-pr-analysis', args: { pr: 'o/r#1' } })).toBe(null)
  expect(launchFieldsError({ name: 'x', args: {}, description: 'd', title: 't' })).toBe(null)
  for (const extra of [{ scriptPath: '/tmp/s.js' }, { script: 'export const meta = {}' }, { resumeFromRunId: 'run1' }, { scriptPath: '' }, { script: null }]) {
    expect(launchFieldsError({ name: 'x', args: { pr: 'o/r#1' }, ...extra })).toBe(BY_NAME_ONLY)
  }
})

test('launchedTaskId: only a launch that answered a taskId and no error started', () => {
  expect(launchedTaskId({ result: { status: 'async_launched', taskId: 'w1' } })).toBe('w1')
  expect(launchedTaskId({ deny: 'no' })).toBe(null)
  expect(launchedTaskId({ isError: true, result: { taskId: 'w1' } })).toBe(null)
  expect(launchedTaskId({ isError: true, result: 'Workflow failed' })).toBe(null)
  expect(launchedTaskId({ result: { taskId: 'w1', error: 'Syntax check failed' } })).toBe(null)
  expect(launchedTaskId({ result: { taskId: '' } })).toBe(null)
  expect(launchedTaskId({ result: { taskId: 7 } })).toBe(null)
  expect(launchedTaskId({ result: undefined })).toBe(null)
  expect(launchedTaskId({ result: 'w1' })).toBe(null)
})

// Through the real hooks: the launch hook sits above the engine's Workflow call, which
// each test answers in turn from `answers` (a function that throws, or the answer).
const WORKFLOW = 'pr-review-toolkit:review-pr-analysis'
type Answer = (e: { args?: { run?: unknown } }) => { result: unknown }
function workflow(on: On, answers: Answer[]) {
  const seen = { calls: 0, nonces: [] as string[] }
  on('tool.call', { tool: 'Workflow' }, async (_$, e) => {
    const ev = e as { args?: { run?: unknown } }
    seen.nonces.push(String(ev.args?.run ?? ''))
    const answer = answers[seen.calls++]!
    return answer(ev) as { result: { taskId: string; status: 'async_launched' } }
  })
  return seen
}
const launch = ($: Engine, extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'Workflow', name: WORKFLOW, args: { pr: 'o/r#1' }, ...extra } as Parameters<typeof $.tool.call>[0])
const started = (): { result: unknown } => ({ result: { status: 'async_launched', taskId: 'w2' } })

test('a launch that answers an error result gives the preparation back', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  world(on)
  const seen = workflow(on, [() => ({ result: { status: 'async_launched', taskId: 'w1', error: 'Syntax check failed' } }), started])
  await $.tool.call({ tool: 'mcp__pr-review-toolkit__prepare_review' })
  const failed = await launch($)
  expect((failed.result as { error?: string }).error).toBe('Syntax check failed')
  // No taskId was recorded, so the same preparation launches again (not "in progress").
  const again = await launch($)
  expect(again.deny).toBeUndefined()
  expect((again.result as { taskId?: string }).taskId).toBe('w2')
  expect(seen.calls).toBe(2)
})

test('a launch whose workflow call throws is denied with the reason, and gives the preparation back', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  world(on)
  const seen = workflow(on, [() => { throw new Error('the workflow engine is down') }, started])
  await $.tool.call({ tool: 'mcp__pr-review-toolkit__prepare_review' })
  const failed = await launch($)
  // The kit skips a hook that throws, so next() rejects with its own "no implementation"
  // error; the deny names whatever message next() rejected with.
  expect(failed.deny).toMatch(/^The review workflow did not start: \S/)
  const again = await launch($)
  expect(again.deny).toBeUndefined()
  expect((again.result as { taskId?: string }).taskId).toBe('w2')
  expect(seen.calls).toBe(2)
})

test('a launch that names another script or an earlier run is denied before it claims the preparation', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  world(on)
  const seen = workflow(on, [started])
  await $.tool.call({ tool: 'mcp__pr-review-toolkit__prepare_review' })
  for (const extra of [{ scriptPath: '/tmp/other.js' }, { script: 'export const meta = { name: "x" }' }, { resumeFromRunId: 'run1' }]) {
    expect((await launch($, extra)).deny).toBe(BY_NAME_ONLY)
  }
  expect(seen.calls).toBe(0)
  const ok = await launch($)
  expect((ok.result as { taskId?: string }).taskId).toBe('w2')
})
