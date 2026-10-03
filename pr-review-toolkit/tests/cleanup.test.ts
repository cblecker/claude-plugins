import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { cancellable, cancelRun, cleanupPlan, CANCELLED, INTERRUPTED, launched, POSTING_REFUSAL, recoverPosting } from '../hooks/lib/cleanup'
import { claimNotice, finishable, rewriteNotice } from '../hooks/lib/completion'
import { inFlightError, launchGate } from '../hooks/lib/launch'
import type { Phase, RunState } from '../hooks/lib/types'
import { PANE, world, WRITES } from './world'

const HEAD = 'a'.repeat(40)
const run = (over: Partial<RunState> = {}): RunState => ({
  handle: 'o/r#1', phase: 'progress', warnings: [],
  pr: { owner: 'o', repo: 'r', number: 1, title: 't', body: '', author: 'a', state: 'open', baseRef: 'main', headSha: HEAD, mergeableState: 'clean', baseRepo: 'o/r' },
  checkoutPath: '/w', mergeBase: 'b'.repeat(40), baseAheadCount: 0, reviewerLogin: 'me',
  diff: { nameStatus: '', numstat: '', shortstat: '' },
  summary: { scale: 'small', changedFileCount: 1, additions: 1, deletions: 0, notableAreas: [], shapeUnavailable: false },
  lenses: [{ name: 'code-reviewer', effort: 'high', rationale: '' }], lensSource: 'selector',
  threads: [], threadCollectionFailed: false, reviews: [], reviewsCollectionFailed: false, followUp: null,
  run: 'r1', taskId: 't1', deposits: {}, verdicts: null, selected: [], drafts: [], event: null, posted: [],
  ...over,
})
const PHASES: Phase[] = ['progress', 'board', 'drafting', 'preview', 'posting', 'done', 'failed']

// ---- session end ----

test('cleanupPlan stops the workflow of a run in progress, and nothing else', () => {
  expect(cleanupPlan(run())).toEqual({ stop: 't1' })
  // Still progress while the board is built: the plan is the same.
  expect(cleanupPlan(run({ synthesizing: true }))).toEqual({ stop: 't1' })
  // Prepared, not launched: no workflow to stop.
  expect(cleanupPlan(run({ taskId: undefined, run: undefined }))).toEqual({ stop: null })
  for (const phase of PHASES.filter((p) => p !== 'progress')) expect(cleanupPlan(run({ phase }))).toEqual({ stop: null })
  expect(cleanupPlan(null)).toEqual({ stop: null })
})

// ---- cancel ----

test('cancel in progress fails the run as Cancelled, keeps the taskId, and stops the workflow', () => {
  const out = cancelRun(run())
  expect(out).toEqual({ run: { ...run(), phase: 'failed', synthesizing: false, error: CANCELLED }, stop: 't1' })
  expect(out.run?.error).toBe('Cancelled')
  expect(out.run?.taskId).toBe('t1')
})

test('cancel while synthesizing clears the flag, so the board that is being built is dropped', () => {
  const synthesizing = run({ synthesizing: true })
  expect(finishable(synthesizing, 't1')).toBe(true)
  const out = cancelRun(synthesizing)
  expect(out.run).toMatchObject({ phase: 'failed', synthesizing: false, error: 'Cancelled', taskId: 't1' })
  expect(out.stop).toBe('t1')
  expect(finishable(out.run, 't1')).toBe(false)
})

test('cancel before the workflow has launched fails the run with no workflow to stop', () => {
  expect(cancelRun(run({ taskId: undefined, run: undefined }))).toMatchObject({ run: { phase: 'failed', error: 'Cancelled' }, stop: null })
  // Mid-launch: the nonce is stored, the taskId is not yet.
  expect(cancelRun(run({ taskId: undefined }))).toMatchObject({ run: { phase: 'failed', error: 'Cancelled', run: 'r1' }, stop: null })
})

test('cancel on the board, while drafting and in the preview fails the run; the workflow is long done', () => {
  for (const phase of ['board', 'drafting', 'preview'] as const) {
    const out = cancelRun(run({ phase, selected: ['F1'], event: 'COMMENT' }))
    expect(out.run).toMatchObject({ phase: 'failed', error: 'Cancelled', taskId: 't1', synthesizing: false })
    expect(out.stop).toBe(null)
    expect(out.refused).toBeUndefined()
  }
})

test('cancel is refused while posting: the run is returned as it was, with the toast text', () => {
  const posting = run({ phase: 'posting' })
  const out = cancelRun(posting)
  expect(out.run).toBe(posting)
  expect(out.stop).toBe(null)
  expect(out.refused).toBe('Posting is in progress; wait for it to finish.')
  expect(POSTING_REFUSAL).toBe(out.refused)
})

test('cancel does nothing to a finished run, a failed one, or no run', () => {
  for (const phase of ['done', 'failed'] as const) {
    const finished = run({ phase })
    expect(cancelRun(finished)).toEqual({ run: finished, stop: null })
    expect(cancelRun(finished).run).toBe(finished)
  }
  expect(cancelRun(null)).toEqual({ run: null, stop: null })
})

test('the cancel control is offered in progress, on the board, drafting and previewing only', () => {
  expect(PHASES.filter((phase) => cancellable(run({ phase })))).toEqual(['progress', 'board', 'drafting', 'preview'])
  expect(cancellable(null)).toBe(false)
})

test('a cancelled run still recognises its late notice, but never claims it, and can be replaced', () => {
  const cancelled = cancelRun(run({ synthesizing: true })).run
  const text = '<task-notification>\n<task-id>t1</task-id>\n<status>completed</status>\n</task-notification>'
  // The notice is rewritten (no workflow result reaches the transcript) ...
  expect(rewriteNotice(text, cancelled)?.ok).toBe(true)
  // ... but it does not advance the run.
  expect(claimNotice(cancelled, 't1', true, 'completed')).toEqual({ run: cancelled, claimed: false })
  // prepare_review may replace it; the same preparation cannot launch again.
  expect(inFlightError(cancelled)).toBe(null)
})

test('a preparation cancelled before it launched cannot launch afterwards', () => {
  const prepared = run({ taskId: undefined, run: undefined })
  expect('deny' in launchGate(prepared, { pr: 'o/r#1' }, HEAD, 1)).toBe(false)
  const cancelled = cancelRun(prepared).run
  const gate = launchGate(cancelled, { pr: 'o/r#1' }, HEAD, 1)
  expect('deny' in gate && gate.deny).toMatch(/cancelled.*prepare_review/)
})

// ---- the launch returning after a cancel ----

test('the workflow launch stores its taskId on the run holding its nonce', () => {
  const launching = run({ taskId: undefined })
  expect(launched(launching, 'r1', 'w9')).toEqual({ run: { ...launching, taskId: 'w9' }, stop: false })
  // Another run, or none: untouched.
  expect(launched(launching, 'r2', 'w9')).toEqual({ run: launching, stop: false })
  expect(launched(null, 'r1', 'w9')).toEqual({ run: null, stop: false })
})

test('a launch that returns after a cancel keeps the cancelled phase and gets its workflow stopped', () => {
  const cancelled = cancelRun(run({ taskId: undefined })).run
  const out = launched(cancelled, 'r1', 'w9')
  expect(out.run).toMatchObject({ phase: 'failed', error: 'Cancelled', taskId: 'w9' })
  expect(out.stop).toBe(true)
})

// ---- a reload mid-post ----

test('a run found posting after a reload ends as done with a warning, never a postable preview', () => {
  const posting = run({ phase: 'posting', posted: ['F1'], selected: ['F2'] })
  const out = recoverPosting(posting)
  expect(out).toEqual({ ...posting, phase: 'done', error: 'Posting was interrupted; check the PR.' })
  expect(out?.error).toBe(INTERRUPTED)
  expect(out?.posted).toEqual(['F1'])
})

test('a reload leaves every other phase, and no run, as it was', () => {
  for (const phase of PHASES.filter((p) => p !== 'posting')) {
    const r = run({ phase })
    expect(recoverPosting(r)).toBe(r)
  }
  expect(recoverPosting(null)).toBe(null)
})

// ---- through the real hooks: session end, cancel and a reload, the engine answered beneath ----

const WORKFLOW = 'pr-review-toolkit:review-pr-analysis'
const END = { sessionId: 's1', resume: { id: 's1' } }

const finding = (title: string, severity: string, confidence: number, path: string, line: number) =>
  ({ location: { path, line }, severity, confidence, title, claim: 'claim ' + title, evidence: 'evidence ' + title, whyItMatters: 'why ' + title })
const NOTICE = (status = 'completed') => ({ text: `<task-notification>\n<task-id>w1</task-id>\n<status>${status}</status>\n</task-notification>`, origin: { kind: 'task-notification' as const }, wait: false })

// The workflow launches with task id w1 and records the nonce it was given; TaskStop is
// recorded by task id.
function review(on: On) {
  const seen = { nonce: '', stopped: [] as string[] }
  on('tool.call', { tool: 'Workflow' }, async (_$, e) => {
    seen.nonce = String((e as { args?: { run?: unknown } }).args?.run ?? '')
    return { result: { taskId: 'w1' } }
  })
  on('tool.call', { tool: 'TaskStop' }, async (_$, e) => {
    const id = String((e as { task_id?: unknown }).task_id)
    seen.stopped.push(id)
    return { result: { message: 'Stopped', task_id: id, task_type: 'local_workflow' } }
  })
  // What the engine does beneath the plugin as a session ends or (re)starts.
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', async (_$, e) => ({ value: { tool: e.name } }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  return seen
}
type Kit = Engine
const launch = async ($: Kit) => {
  await $.tool.call({ tool: 'mcp__pr-review-toolkit__prepare_review' })
  await $.tool.call({ tool: 'Workflow', name: WORKFLOW, args: { pr: 'o/r#1' } } as Parameters<typeof $.tool.call>[0])
}

test('session.end stops the running workflow without waiting for it, resets the run, and passes the end on', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  world(on)
  const seen = review(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await launch($)
  expect(await ui.find({ type: 'Text', text: /^Running 8 lenses…$/ })).toBeDefined()

  const started = Date.now()
  const out = await $.session.end({ reason: 'clear', ...END })
  expect(Date.now() - started).toBeLessThan(1500)
  expect(out).toEqual({ sessionId: 's1' })
  await clock.settle()
  expect(seen.stopped).toEqual(['w1'])
  // The run is gone: the pane has nothing, and a late deposit finds no run.
  expect(await ui.find({ type: 'Text', text: /No review in progress/ })).toBeDefined()
  const late = await $.tool.call({ tool: 'mcp__pr-review-toolkit__submit_findings', run: seen.nonce, lens: 'code-reviewer', findings: [], positiveObservations: [] } as Parameters<typeof $.tool.call>[0])
  expect(late.result).toBe('rejected: unknown run')
  await ui.unmount()
})

const deposit = ($: Kit, nonce: string) => $.tool.call({ tool: 'mcp__pr-review-toolkit__submit_findings', run: nonce, lens: 'code-reviewer',
  findings: [finding('Parser drops the last token', 'critical', 95, 'a.go', 3), finding('Error is swallowed', 'important', 90, 'b.go', 5)],
  positiveObservations: [] } as Parameters<typeof $.tool.call>[0])

test('session.end on a board stops nothing, and still resets the run', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  world(on)
  const seen = review(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await launch($)
  await deposit($, seen.nonce)
  await $.prompt.submit(NOTICE())
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /^Recommended to post \(2\) / })).toBeDefined()

  for (const reason of ['resume', 'prompt_input_exit'] as const) {
    expect(await $.session.end({ reason, ...END })).toEqual({ sessionId: 's1' })
  }
  await clock.settle()
  expect(seen.stopped).toEqual([])
  expect(await ui.find({ type: 'Text', text: /No review in progress/ })).toBeDefined()
  await ui.unmount()
})

test('a session that ends with no run is a plain pass-through', async ($, on) => {
  world(on)
  const seen = review(on)
  expect(await $.session.end({ reason: 'clear', ...END })).toEqual({ sessionId: 's1' })
  expect(seen.stopped).toEqual([])
})

test('cancel in progress stops the workflow, marks the run cancelled, and turns a late deposit away', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  const w = world(on)
  const seen = review(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await launch($)
  expect((await ui.find({ key: 'cancel' }))?.props.hotkey).toBeUndefined()
  const accepted = await deposit($, seen.nonce)
  expect(accepted.result).toBe('accepted')

  await ui.press({ key: 'cancel' })
  await clock.settle()
  expect(seen.stopped).toEqual(['w1'])
  expect(await ui.find({ type: 'Text', text: '⚠ Review cancelled.' })).toBeDefined()
  expect(await ui.find({ key: 'cancel' })).toBeUndefined()

  // A lens agent that was still running deposits: told not to send it again.
  const late = await deposit($, seen.nonce)
  expect(late.result).toBe('rejected: this review run is no longer collecting results. Do not resubmit.')

  // A completion notice that was already on its way is rewritten, and changes nothing:
  // the run stays cancelled and no board opens.
  const notice = await $.prompt.submit(NOTICE())
  expect(notice.text).toBe('Review complete — the board is opening in the review pane (/review-board).')
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '⚠ Review cancelled.' })).toBeDefined()
  expect(w.opened).toEqual([{ id: 'pr-review', title: 'PR review' }])

  // The same preparation cannot launch again; prepare_review starts a new run.
  const again = await $.tool.call({ tool: 'Workflow', name: WORKFLOW, args: { pr: 'o/r#1' } } as Parameters<typeof $.tool.call>[0])
  expect(again.deny).toMatch(/already used/)
  await $.tool.call({ tool: 'mcp__pr-review-toolkit__prepare_review' })
  expect(await ui.find({ type: 'Text', text: /^Analyzing: / })).toBeDefined()
  await ui.unmount()
})

test('cancel before the workflow launched fails the run with nothing to stop, and the preparation cannot launch', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  world(on)
  const seen = review(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.tool.call({ tool: 'mcp__pr-review-toolkit__prepare_review' })
  expect(await ui.find({ type: 'Text', text: /waiting for the review workflow to start/ })).toBeDefined()
  await ui.press({ key: 'cancel' })
  await clock.settle()
  expect(seen.stopped).toEqual([])
  expect(await ui.find({ type: 'Text', text: '⚠ Review cancelled.' })).toBeDefined()
  const out = await $.tool.call({ tool: 'Workflow', name: WORKFLOW, args: { pr: 'o/r#1' } } as Parameters<typeof $.tool.call>[0])
  expect(out.deny).toBe('This preparation was cancelled; run prepare_review again.')
  expect(seen.nonce).toBe('')
  await ui.unmount()
})

test('a cancel pressed while the workflow is launching is not undone by the launch, which is stopped', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  world(on)
  const stopped: string[] = []
  let pressed = null as (() => Promise<unknown>) | null
  // The launch is under way (a permission prompt, say) while the person cancels.
  on('tool.call', { tool: 'Workflow' }, async () => {
    await pressed?.()
    return { result: { taskId: 'w1' } }
  })
  on('tool.call', { tool: 'TaskStop' }, async (_$, e) => {
    const id = String((e as { task_id?: unknown }).task_id)
    stopped.push(id)
    return { result: { message: 'Stopped', task_id: id, task_type: 'local_workflow' } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  pressed = () => ui.press({ key: 'cancel' })
  await $.tool.call({ tool: 'mcp__pr-review-toolkit__prepare_review' })
  await $.tool.call({ tool: 'Workflow', name: WORKFLOW, args: { pr: 'o/r#1' } } as Parameters<typeof $.tool.call>[0])
  await clock.settle()
  expect(stopped).toEqual(['w1'])
  expect(await ui.find({ type: 'Text', text: '⚠ Review cancelled.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Running / })).toBeUndefined()
  // Its notice, should one come, is still the plugin's to rewrite.
  expect((await $.prompt.submit(NOTICE('killed'))).text).toBe('Review failed: killed — see the review pane.')
  await ui.unmount()
})

test('cancel while the board is being built drops the board', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  const model: { current?: Promise<unknown> } = {}
  const w = world(on, { holdModel: model })
  const seen = review(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await launch($)
  await deposit($, seen.nonce)
  // From here the model does not answer until the test says so.
  let built!: () => void
  model.current = new Promise<void>((resolve) => { built = resolve })
  // The notice claims the run; synthesis runs detached from it.
  await $.prompt.submit(NOTICE())
  const synthesizing = (await ui.find({ type: 'Text', text: /^Synthesizing…/ })) !== undefined
  expect(synthesizing).toBe(true)
  await ui.press({ key: 'cancel' })
  // The synthesis finishes after the cancel; its board is not written.
  built()
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '⚠ Review cancelled.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Recommended to post/ })).toBeUndefined()
  expect(w.opened).toEqual([{ id: 'pr-review', title: 'PR review' }])
  await ui.unmount()
})

// A board with two recommended findings, drafted and previewed, the GitHub writes held
// (release() lets them through): Post pressed once, so the run is posting.
async function posting($: Kit, on: On, release: { go?: () => void }, extra: (on: On) => void = () => {}) {
  const gate = new Promise<void>((resolve) => { release.go = resolve })
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  const w = world(on, { hold: gate })
  const seen = review(on)
  extra(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await launch($)
  await deposit($, seen.nonce)
  await $.prompt.submit(NOTICE())
  await clock.settle()
  await ui.press({ key: 'draft' })
  const drafts = await $.tool.call({ tool: 'mcp__pr-review-toolkit__set_drafts', drafts: [
    { id: 'F1', kind: 'line', path: 'a.go', line: 3, body: 'This drops the last token.' },
    { id: 'F2', kind: 'body', body: 'The error from parse is swallowed.' },
  ] } as Parameters<typeof $.tool.call>[0])
  expect(drafts.result).toMatch(/^accepted/)
  expect(await ui.find({ type: 'Text', text: /^Post this review$|^1 line comment/ })).toBeDefined()
  await ui.press({ key: 'post' })
  expect(await ui.find({ type: 'Text', text: 'Posting to o/r#1…' })).toBeDefined()
  return { ui, w, seen, clock }
}
const START = { cwd: '/w', surface: 'terminal' as const, isInteractive: true }

test('a reload during a post ends the run as interrupted, and the late outcome cannot reopen it', async ($, on) => {
  const release: { go?: () => void } = {}
  const { ui, w, clock } = await posting($, on, release)
  expect(w.writes.map((x) => x.key)).toEqual([WRITES[0]])

  // The reload runs session.start again; the post's module variables are gone.
  await $.session.start(START)
  expect(await ui.find({ type: 'Text', text: '⚠ Posting was interrupted; check the PR.' })).toBeDefined()
  // Never back at a preview that posts the same review again.
  expect(await ui.find({ key: 'post' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Posting to o/r#1…' })).toBeUndefined()

  // Were the old post to answer after all, it records what it posted and nothing else.
  release.go?.()
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '⚠ Posting was interrupted; check the PR.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Posted items: F1, F2.' })).toBeDefined()
  expect(await ui.find({ key: 'post' })).toBeUndefined()
  await ui.unmount()
})

test('a session.start with a run that is not posting leaves it alone', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  world(on)
  const seen = review(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await launch($)
  await $.session.start(START)
  await clock.settle()
  expect(seen.stopped).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^Running 8 lenses…$/ })).toBeDefined()
  await ui.unmount()
})

test('a post whose outcome cannot be written still ends the run, as done with the warning', async ($, on) => {
  const release: { go?: () => void } = {}
  let refused = 0
  // The write that records how the post went is refused; the fallback write, which carries
  // the warning, goes through.
  const { ui, clock } = await posting($, on, release, (hooks) => {
    hooks('state.set', { plugin: 'pr-review-toolkit', key: 'run' }, async (_$, e, next) => {
      const value = e.value as RunState | null
      if (value?.phase === 'done' && value.error !== 'Posting was interrupted; check the PR.') { refused++; return { deny: 'state write refused' } }
      return next(e)
    })
  })
  release.go?.()
  await clock.settle()
  expect(refused).toBeGreaterThan(0)
  // Not stuck on 'Posting…', and not a preview that would post again.
  expect(await ui.find({ type: 'Text', text: 'Posting to o/r#1…' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '⚠ Posting was interrupted; check the PR.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Posted items: F1, F2.' })).toBeDefined()
  expect(await ui.find({ key: 'post' })).toBeUndefined()
  await ui.unmount()
})

test('cancel while Claude is drafting fails the run, and the drafts that arrive after are refused', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  world(on)
  const seen = review(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await launch($)
  await deposit($, seen.nonce)
  await $.prompt.submit(NOTICE())
  await clock.settle()
  await ui.press({ key: 'draft' })
  expect(await ui.find({ type: 'Text', text: /^Claude is drafting…/ })).toBeDefined()

  await ui.press({ key: 'cancel' })
  expect(seen.stopped).toEqual([])
  expect(await ui.find({ type: 'Text', text: '⚠ Review cancelled.' })).toBeDefined()
  const drafts = await $.tool.call({ tool: 'mcp__pr-review-toolkit__set_drafts', drafts: [
    { id: 'F1', kind: 'line', path: 'a.go', line: 3, body: 'This drops the last token.' },
    { id: 'F2', kind: 'body', body: 'The error from parse is swallowed.' },
  ] } as Parameters<typeof $.tool.call>[0])
  expect(drafts.result).toMatch(/^rejected: no drafts are being collected right now\. Do not call set_drafts again/)
  expect(await ui.find({ type: 'Text', text: '⚠ Review cancelled.' })).toBeDefined()
  await ui.unmount()
})
