import { expect, test } from 'claude-code/testing'
import { applyDeposit } from '../hooks/lib/deposit'
import { parseModelJson } from '../hooks/lib/json'

const good = { location: { path: 'a.go', line: 3 }, severity: 'important', confidence: 85, title: 't', claim: 'c', evidence: 'e', whyItMatters: 'w' }
const base: any = { run: 'r1', phase: 'progress', lenses: [{ name: 'code-reviewer' }], deposits: {}, verdicts: null }

test('accepts a valid submission and stores it by lens', () => {
  const { answer, run } = applyDeposit(base, { run: 'r1', lens: 'code-reviewer', findings: [good], positiveObservations: [] }, 'findings')
  expect(answer).toBe('accepted')
  expect(run.deposits['code-reviewer']?.findings.length).toBe(1)
})

test('rejects missing fields with named errors', () => {
  const { answer } = applyDeposit(base, { run: 'r1', lens: 'code-reviewer', findings: [{ ...good, evidence: '' }], positiveObservations: [] }, 'findings')
  expect(answer).toMatch(/^rejected: findings\[0\]\.evidence is required.*Resubmit\.$/)
})

test('rejects an unknown run nonce and an unselected lens', () => {
  expect(applyDeposit(base, { run: 'zzz', lens: 'code-reviewer', findings: [], positiveObservations: [] }, 'findings').answer).toBe('rejected: unknown run')
  expect(applyDeposit(base, { run: 'r1', lens: 'nope', findings: [], positiveObservations: [] }, 'findings').answer).toMatch(/lens "nope" was not selected/)
})

test('a missing run state answers unknown run without throwing', () => {
  const out = applyDeposit(null, { run: 'r1', lens: 'code-reviewer', findings: [good], positiveObservations: [] }, 'findings')
  expect(out.answer).toBe('rejected: unknown run')
  expect(out.run).toBe(null)
  expect(applyDeposit(null, { run: 'r1', items: [] }, 'followup').answer).toBe('rejected: unknown run')
})

test('a prepared run that is not yet launched has no nonce to match', () => {
  const unlaunched: any = { ...base, run: undefined }
  expect(applyDeposit(unlaunched, { run: undefined, lens: 'code-reviewer', findings: [], positiveObservations: [] }, 'findings').answer).toBe('rejected: unknown run')
})

test('a later valid submission replaces the earlier one', () => {
  const one = applyDeposit(base, { run: 'r1', lens: 'code-reviewer', findings: [good], positiveObservations: [] }, 'findings').run
  const two = applyDeposit(one, { run: 'r1', lens: 'code-reviewer', findings: [], positiveObservations: ['x'] }, 'findings').run
  expect(two.deposits['code-reviewer']).toEqual({ findings: [], positiveObservations: ['x'] })
})

test('a rejected submission leaves the run state unchanged', () => {
  const { run } = applyDeposit(base, { run: 'r1', lens: 'code-reviewer', findings: [{ ...good, severity: 'blocker' }], positiveObservations: [] }, 'findings')
  expect(run).toBe(base)
})

test('deposits are accepted only while the run is in progress', () => {
  const input = { run: 'r1', lens: 'code-reviewer', findings: [good], positiveObservations: [] }
  for (const phase of ['board', 'drafting', 'preview', 'posting', 'done', 'failed'] as const) {
    const run = { ...base, phase }
    const out = applyDeposit(run, input, 'findings')
    expect(out.answer).toBe('rejected: this review run is no longer collecting results. Do not resubmit.')
    expect(out.run).toBe(run)
    const verdicts = applyDeposit(run, { run: 'r1', items: [{ ask: 'a', status: 'addressed', evidence: 'e' }] }, 'followup')
    expect(verdicts.answer).toMatch(/^rejected: this review run is no longer collecting results\. Do not resubmit\.$/)
    expect(verdicts.run).toBe(run)
  }
  expect(applyDeposit(base, input, 'findings').answer).toBe('accepted')
})

test('a cancelled run refuses a late deposit, and the nonce is still checked first', () => {
  const cancelled = { ...base, phase: 'failed', error: 'Cancelled', taskId: 't1' }
  expect(applyDeposit(cancelled, { run: 'r1', lens: 'code-reviewer', findings: [good], positiveObservations: [] }, 'findings').answer).toMatch(/no longer collecting results/)
  expect(applyDeposit(cancelled, { run: 'zzz', lens: 'code-reviewer', findings: [good], positiveObservations: [] }, 'findings').answer).toBe('rejected: unknown run')
})

test('findings validation names severity, confidence, location and shape errors', () => {
  const answer = (f: unknown, extra: object = {}) =>
    applyDeposit(base, { run: 'r1', lens: 'code-reviewer', findings: [f], positiveObservations: [], ...extra }, 'findings').answer
  expect(answer({ ...good, severity: 'blocker' })).toMatch(/findings\[0\]\.severity must be critical\|important\|suggestion/)
  expect(answer({ ...good, confidence: 101 })).toMatch(/findings\[0\]\.confidence must be a number 0-100/)
  expect(answer({ ...good, confidence: '85' })).toMatch(/findings\[0\]\.confidence must be a number 0-100/)
  expect(answer({ ...good, location: { line: 3 } })).toMatch(/findings\[0\]\.location\.path is required/)
  expect(answer(null)).toMatch(/findings\[0\]\.title is required/)
  expect(answer(good, { findings: 'nope' })).toMatch(/findings must be an array/)
  expect(answer(good, { positiveObservations: undefined })).toMatch(/positiveObservations must be an array of strings/)
})

test('verdicts validate status enum', () => {
  const { answer } = applyDeposit(base, { run: 'r1', items: [{ ask: 'a', status: 'done', evidence: 'e' }] }, 'followup')
  expect(answer).toMatch(/items\[0\]\.status must be addressed\|partial\|not_addressed\|unverifiable/)
})

test('verdicts require an items array and store valid ones on the run', () => {
  expect(applyDeposit(base, { run: 'r1' }, 'followup').answer).toMatch(/items must be an array/)
  const items = [{ ask: 'a', status: 'addressed', evidence: 'e' }]
  const out = applyDeposit(base, { run: 'r1', items }, 'followup')
  expect(out.answer).toBe('accepted')
  expect(out.run.verdicts).toEqual(items)
})

test('rejection lists at most ten errors', () => {
  const bad = Array.from({ length: 5 }, () => ({}))
  const { answer } = applyDeposit(base, { run: 'r1', lens: 'code-reviewer', findings: bad, positiveObservations: [] }, 'findings')
  expect(answer.slice('rejected: '.length).split('; ').length).toBe(10)
})

test('parseModelJson strips fences and prose', () => {
  expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  expect(parseModelJson('Here you go:\n{"a":2}\nThanks')).toEqual({ a: 2 })
  expect(parseModelJson('nope')).toBe(null)
})
