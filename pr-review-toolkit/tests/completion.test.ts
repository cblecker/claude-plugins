import { expect, test } from 'claude-code/testing'
import { claimNotice, completionLine, failSynthesis, finishable, lensOutcome, noticeFor, rewriteNotice, withOutcome } from '../hooks/lib/completion'
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
  const line = 'Review complete — the board is opening in the review pane (/review-board).'
  expect(hit).toEqual({ text: line, line, ok: true, status: 'completed' })
  expect(hit?.text).not.toMatch(/leaked|task-notification|w1/)
})

test('our failed notice is rewritten to the failure line naming the status', () => {
  const line = 'Review failed: failed — see the review pane.'
  expect(rewriteNotice(notice('w1', 'failed'), run)).toEqual({ text: line, line, ok: false, status: 'failed' })
  expect(rewriteNotice(notice('w1', 'killed'), run)?.text).toBe('Review failed: killed — see the review pane.')
  expect(completionLine(false, 'killed')).toBe('Review failed: killed — see the review pane.')
  expect(completionLine(true, 'completed')).toBe('Review complete — the board is opening in the review pane (/review-board).')
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

test('the status is read inside our notice only, and trimmed', () => {
  const other = notice('w2', 'completed')
  expect(noticeFor(`${other}\n${notice('w1', 'failed')}`, 'w1')).toEqual({ status: 'failed' })
  expect(noticeFor(`${notice('w1', 'failed')}\n${other}`, 'w1')).toEqual({ status: 'failed' })
  expect(noticeFor('<task-notification>\n<task-id>w1</task-id>\n<status> completed </status>\n</task-notification>', 'w1')).toEqual({ status: 'completed' })
})

test('two notices in one text: only ours is replaced, the other kept whole', () => {
  const other = notice('w2', 'completed')
  const failed = 'Review failed: failed — see the review pane.'
  const a = rewriteNotice(`${other}\n${notice('w1', 'failed')}`, run)
  expect(a).toEqual({ text: `${other}\n${failed}`, line: failed, ok: false, status: 'failed' })
  const b = rewriteNotice(`${notice('w1', 'failed')}\n${other}`, run)
  expect(b?.text).toBe(`${failed}\n${other}`)
  expect(b?.ok).toBe(false)
})

test('text around our notice is kept', () => {
  const line = 'Review complete — the board is opening in the review pane (/review-board).'
  expect(rewriteNotice(`Earlier text\n${notice('w1', 'completed')}\nLater text`, run)?.text).toBe(`Earlier text\n${line}\nLater text`)
})

test('a text with no wrapper is taken whole; an unterminated wrapper never leaks', () => {
  const line = 'Review complete — the board is opening in the review pane (/review-board).'
  expect(rewriteNotice('<task-id>w1</task-id> <status>completed</status>', run)?.text).toBe(line)
  const open = '<task-notification>\n<task-id>w1</task-id>\n<status>completed</status>\n<result>{"findings":[]}</result>'
  expect(rewriteNotice(open, run)?.text).toBe(line)
})

test('our tag outside any notice block, among other notices, passes through', () => {
  expect(rewriteNotice(`${notice('w2', 'completed')}\nsee <task-id>w1</task-id>`, run)).toBe(null)
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

test('a detached finish writes only onto the run it claimed (same taskId, in progress, synthesizing)', () => {
  const claimed: any = { ...run, synthesizing: true }
  expect(finishable(claimed, 'w1')).toBe(true)
  expect(finishable(claimed, 'w2')).toBe(false)
  expect(finishable(null, 'w1')).toBe(false)
  expect(finishable({ ...claimed, synthesizing: false }, 'w1')).toBe(false) // cancelled during synthesis
  expect(finishable({ ...claimed, synthesizing: undefined }, 'w1')).toBe(false)
  expect(finishable({ ...claimed, phase: 'failed' }, 'w1')).toBe(false)
  expect(finishable({ ...claimed, phase: 'board' }, 'w1')).toBe(false)
})

test('a failed synthesis fails only the claimed run', () => {
  const claimed: any = { ...run, synthesizing: true }
  expect(failSynthesis(claimed, 'w1', 'boom')).toMatchObject({ phase: 'failed', synthesizing: false, error: 'Review board failed: boom' })
  const newer = { ...claimed, taskId: 'w9' }
  expect(failSynthesis(newer, 'w1', 'boom')).toBe(newer)
  const cancelled = { ...claimed, synthesizing: false, phase: 'failed' }
  expect(failSynthesis(cancelled, 'w1', 'boom')).toBe(cancelled)
  expect(failSynthesis(null, 'w1', 'boom')).toBe(null)
})
