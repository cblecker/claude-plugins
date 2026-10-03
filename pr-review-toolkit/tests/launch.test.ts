import { expect, test } from 'claude-code/testing'
import { inFlightError, launchGate, newNonce } from '../hooks/lib/launch'
import type { FollowUpContext, RunState } from '../hooks/lib/types'

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
