import { expect, test } from 'claude-code/testing'
import { claimNotice, completionLine, lensOutcome, noticeFor, rewriteNotice, withOutcome } from '../hooks/lib/completion'
import type { RunState } from '../hooks/lib/types'

const notice = (id: string, status: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/tmp/${id}.output</output-file>\n<status>${status}</status>\n<summary>Workflow "review-pr-analysis" ${status}</summary>\n<result>{"findings":[{"title":"leaked"}]}</result>\n</task-notification>`

const run: any = { handle: 'o/r#1', phase: 'progress', taskId: 'w1', lenses: [{ name: 'code-reviewer' }], deposits: {}, followUp: null, verdicts: null }

test('matches the notice for our task and reads its status', () => {
  const t = '<task-notification>\n<task-id>w1</task-id>\n<status>completed</status>\n</task-notification>'
  expect(noticeFor(t, 'w1')).toEqual({ status: 'completed' })
  expect(noticeFor(t, 'w2')).toBe(null)
  expect(noticeFor(t, undefined)).toBe(null)
  expect(noticeFor(t, '')).toBe(null)
})

test('a notice without a status reads as unknown', () => {
  expect(noticeFor('<task-notification>\n<task-id>w1</task-id>\n</task-notification>', 'w1')).toEqual({ status: 'unknown' })
})

test('selected lenses without a deposit are failed', () => {
  const r: any = { lenses: [{ name: 'code-reviewer' }, { name: 'pr-test-analyzer' }], deposits: { 'code-reviewer': { findings: [], positiveObservations: [] } }, followUp: {}, verdicts: null }
  expect(lensOutcome(r)).toEqual({ failed: ['pr-test-analyzer'], verifierFailed: true })
})

test('the verifier fails only when a follow-up was due and no verdicts arrived', () => {
  const base: any = { lenses: [{ name: 'code-reviewer' }], deposits: { 'code-reviewer': { findings: [], positiveObservations: [] } } }
  expect(lensOutcome({ ...base, followUp: null, verdicts: null })).toEqual({ failed: [], verifierFailed: false })
  expect(lensOutcome({ ...base, followUp: {}, verdicts: [] })).toEqual({ failed: [], verifierFailed: false })
})

test('our completed notice is rewritten to the one line, with no workflow data left', () => {
  const hit = rewriteNotice(notice('w1', 'completed'), run)
  expect(hit).toEqual({ line: 'Review complete — the board is open in the review pane.', ok: true, status: 'completed' })
  expect(hit?.line).not.toMatch(/leaked|task-notification|w1/)
})

test('our failed notice is rewritten to the failure line naming the status', () => {
  expect(rewriteNotice(notice('w1', 'failed'), run)).toEqual({ line: 'Review failed: failed — see the review pane.', ok: false, status: 'failed' })
  expect(rewriteNotice(notice('w1', 'killed'), run)?.line).toBe('Review failed: killed — see the review pane.')
  expect(completionLine(false, 'killed')).toBe('Review failed: killed — see the review pane.')
  expect(completionLine(true, 'completed')).toBe('Review complete — the board is open in the review pane.')
})

test("another task's notice, or one with no run, passes through", () => {
  expect(rewriteNotice(notice('w2', 'completed'), run)).toBe(null)
  expect(rewriteNotice(notice('w1', 'completed'), null)).toBe(null)
  expect(rewriteNotice(notice('w1', 'completed'), { taskId: undefined })).toBe(null)
})

test('text that holds the taskId but not the <task-id> tag passes through', () => {
  // An edited_text_file attachment can quote the id; only the exact tag is a notice.
  expect(rewriteNotice('Note: the file /tmp/w1.output was modified (w1)', run)).toBe(null)
  expect(rewriteNotice('<task-id> w1 </task-id> <status>completed</status>', run)).toBe(null)
  expect(rewriteNotice('<task-id>w10</task-id><status>completed</status>', run)).toBe(null)
  expect(rewriteNotice('task-id: w1\nstatus: completed', run)).toBe(null)
})

test('the first completed notice claims the run for synthesis; a duplicate does not', () => {
  const first = claimNotice(run as RunState, 'w1', true, 'completed')
  expect(first.claimed).toBe(true)
  expect(first.run).toMatchObject({ phase: 'progress', synthesizing: true })
  const again = claimNotice(first.run, 'w1', true, 'completed')
  expect(again.claimed).toBe(false)
  expect(again.run).toBe(first.run)
})

test('a failed notice fails the run once', () => {
  const first = claimNotice(run as RunState, 'w1', false, 'killed')
  expect(first.claimed).toBe(true)
  expect(first.run).toMatchObject({ phase: 'failed', error: 'Workflow killed' })
  expect(claimNotice(first.run, 'w1', false, 'killed').claimed).toBe(false)
})

test('only a run in progress with the same taskId is claimed', () => {
  expect(claimNotice(null, 'w1', true, 'completed')).toEqual({ run: null, claimed: false })
  expect(claimNotice(run as RunState, 'w2', true, 'completed').claimed).toBe(false)
  for (const phase of ['board', 'drafting', 'preview', 'posting', 'done', 'failed'] as const) {
    const later = { ...run, phase }
    expect(claimNotice(later as RunState, 'w1', true, 'completed')).toEqual({ run: later, claimed: false })
  }
})

test('finishing records the lens outcome for the board', () => {
  const r: any = { ...run, synthesizing: true, lenses: [{ name: 'code-reviewer' }, { name: 'pr-test-analyzer' }], deposits: { 'code-reviewer': { findings: [], positiveObservations: [] } }, followUp: {}, verdicts: null }
  expect(withOutcome(r)).toMatchObject({ failedLenses: ['pr-test-analyzer'], verifierFailed: true })
})
