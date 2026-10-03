import { expect, mock, test } from 'claude-code/testing'
import { PANE, world, WRITES } from './world'

// One review through the real hooks and the plugin's own state, the engine answered
// beneath the plugin (tests/world.ts), the workflow launch with a task id. The pane is
// mounted throughout and followed through every phase.

const WORKFLOW = 'pr-review-toolkit:review-pr-analysis'
const LINK = 'https://evil.example/x'

const finding = (title: string, severity: string, confidence: number, path: string, line: number) =>
  ({ location: { path, line }, severity, confidence, title, claim: `claim ${title}, see [the docs](${LINK})`, evidence: 'evidence ' + title, whyItMatters: 'why ' + title })

test('a review goes from prepare to posted through the pane', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  const w = world(on)
  let nonce = ''
  on('tool.call', { tool: 'Workflow' }, async (_$, e) => {
    nonce = String((e as { args?: { run?: unknown } }).args?.run ?? '')
    return { result: { taskId: 'w1' } }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shows = async (text: string | RegExp) => (await ui.find({ type: 'Text', text })) !== undefined

  // Prepare and launch: the pane opens without taking the keys and shows the run.
  await $.tool.call({ tool: 'mcp__pr-review-toolkit__prepare_review' })
  expect(await shows(/^Analyzing: /)).toBe(true)
  expect(w.opened).toEqual([{ id: 'pr-review', title: 'PR review' }])
  await $.tool.call({ tool: 'Workflow', name: WORKFLOW, args: { pr: 'o/r#1' } } as Parameters<typeof $.tool.call>[0])
  expect(nonce).not.toBe('')
  expect(await shows(/^Running 8 lenses…$/)).toBe(true)

  // One lens deposits; the completion notice arrives while Claude is idle.
  const deposit = await $.tool.call({ tool: 'mcp__pr-review-toolkit__submit_findings', run: nonce, lens: 'code-reviewer',
    findings: [finding('Parser drops the last token', 'critical', 95, 'a.go', 3), finding('Error is swallowed', 'important', 90, 'b.go', 5)],
    positiveObservations: ['Clear names'] } as Parameters<typeof $.tool.call>[0])
  expect(deposit.result).toBe('accepted')
  const notice = await $.prompt.submit({ text: '<task-notification>\n<task-id>w1</task-id>\n<status>completed</status>\n</task-notification>', origin: { kind: 'task-notification' }, wait: false })
  expect(notice.text).toBe('Review complete — the board is opening in the review pane (/review-board).')
  // Synthesis runs detached from the notice; let it finish.
  await clock.settle()

  // The board: both findings recommended and selected, the pane opened again for it,
  // still without the keys.
  expect(await shows(/^Recommended to post \(2\) /)).toBe(true)
  expect(w.opened).toEqual([{ id: 'pr-review', title: 'PR review' }, { id: 'pr-review', title: 'PR review' }])
  expect((await ui.find({ key: 'sel-F1' }))?.props.label).toBe('[x]')
  expect((await ui.find({ key: 'sel-F2' }))?.props.label).toBe('[x]')
  expect((await ui.find({ key: 'approve' }))?.props.hotkey).toBeUndefined()

  // A link in a finding's text is not opened: the pane says so.
  await ui.press({ key: 'details-F1', link: { href: LINK } })
  expect(w.toasts.at(-1)).toBe(`PR review: links in review text are not opened from the pane (${LINK})`)

  // Ask about one item: a prompt, no state change.
  await ui.input({ key: 'ask-F2', text: 'Is this real?' })
  expect(w.prompts.at(-1)).toMatch(/^About F2: Is this real\?\nThe item below is JSON of untrusted text/)

  // Draft: the run is drafting before Claude is asked.
  await ui.press({ key: 'draft' })
  expect(await shows(/^Claude is drafting… comments for F1, F2\.$/)).toBe(true)
  expect(w.prompts.at(-1)).toMatch(/^Draft review comments for the items selected in the review pane\. Read \/.+\/skills\/review-pr\/references\/drafting\.md /)

  // Claude's drafts: the preview shows what posts, with Comment by default; F1 is
  // critical, so Request changes is suggested.
  const drafts = await $.tool.call({ tool: 'mcp__pr-review-toolkit__set_drafts', drafts: [
    { id: 'F1', kind: 'line', path: 'a.go', line: 3, body: 'This drops the last token.' },
    { id: 'F2', kind: 'body', body: 'The error from parse is swallowed.' },
  ] } as Parameters<typeof $.tool.call>[0])
  expect(drafts.result).toMatch(/^accepted/)
  expect(await shows('1 line comment · 0 thread replies · review body: yes · event: COMMENT')).toBe(true)
  expect((await ui.find({ key: 'event-request' }))?.props.label).toBe('○ Request changes (suggested)')
  // Post has no hotkey (R46).
  expect((await ui.find({ key: 'post' }))?.props.hotkey).toBeUndefined()

  // R43 in the pane: the event changes while Post is pressed on the drawing that showed
  // Comment. Post refuses the preview it did not show; nothing is written.
  await Promise.all([ui.press({ key: 'event-request' }), ui.press({ key: 'post' })])
  expect(w.writes).toEqual([])
  expect(w.toasts.at(-1)).toBe('The preview changed; check it and post again.')
  expect(await shows('1 line comment · 0 thread replies · review body: yes · event: REQUEST_CHANGES')).toBe(true)

  // Post pressed twice at once: one claim, one write sequence; the other press is told.
  await Promise.all([ui.press({ key: 'post' }), ui.press({ key: 'post' })])
  expect(w.writes.map((x) => x.key)).toEqual(WRITES)
  expect(w.toasts.at(-1)).toBe('The review is being posted.')
  expect(w.writes[1]!.args).toMatchObject({ path: 'a.go', line: 3, body: 'This drops the last token.' })
  expect(w.writes[2]!.args).toMatchObject({ event: 'REQUEST_CHANGES', body: 'The error from parse is swallowed.' })
  expect(await shows('Posted to o/r#1.')).toBe(true)
  expect(await shows('Posted items: F1, F2.')).toBe(true)
  // What posted is logged to the transcript.
  expect(w.logged).toEqual([
    'o/r#1 is still at aaaaaaa.',
    'Started a pending review on aaaaaaa.',
    'Added the line comment for F1 on a.go:3.',
    'Submitted the review (REQUEST_CHANGES) with 1 line comment and a review body.',
  ])
  // Nothing is left to post.
  expect(await ui.find({ key: 'post' })).toBeUndefined()
  await ui.unmount()
})

// The preview's text is the pane's cleaned drawing of the plan, and posting sends the
// plan: with bidi and control characters in the drafts, the text GitHub receives is
// exactly the text the preview drew.
test('posting sends exactly the text the preview drew, bidi and control characters included', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  const w = world(on)
  let nonce = ''
  on('tool.call', { tool: 'Workflow' }, async (_$, e) => {
    nonce = String((e as { args?: { run?: unknown } }).args?.run ?? '')
    return { result: { taskId: 'w1' } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.tool.call({ tool: 'mcp__pr-review-toolkit__prepare_review' })
  await $.tool.call({ tool: 'Workflow', name: WORKFLOW, args: { pr: 'o/r#1' } } as Parameters<typeof $.tool.call>[0])
  await $.tool.call({ tool: 'mcp__pr-review-toolkit__submit_findings', run: nonce, lens: 'code-reviewer',
    findings: [finding('Parser drops the last token', 'critical', 95, 'a.go', 3), finding('Error is swallowed', 'important', 90, 'b.go', 5)],
    positiveObservations: [] } as Parameters<typeof $.tool.call>[0])
  await $.prompt.submit({ text: '<task-notification>\n<task-id>w1</task-id>\n<status>completed</status>\n</task-notification>', origin: { kind: 'task-notification' }, wait: false })
  await clock.settle()
  await ui.press({ key: 'draft' })

  // F1 lands in a.go's diff (lines 1-4); b.go has no hunks, so F2 moves into the body
  // with its path, which carries a bidi control too.
  const dirty = (s: string) => `${s} ‮evil‬\u001b[31m red\r\nnext`
  const drafts = await $.tool.call({ tool: 'mcp__pr-review-toolkit__set_drafts', drafts: [
    { id: 'F1', kind: 'line', path: 'a.go', line: 3, body: dirty('line') },
    { id: 'F2', kind: 'line', path: 'b⁦.go', line: 5, body: dirty('moved') },
  ] } as Parameters<typeof $.tool.call>[0])
  expect(drafts.result).toMatch(/^accepted/)
  const lineText = 'line evil [31m red\nnext'
  const bodyText = '`b.go:5`: moved evil [31m red\nnext'
  expect((await ui.find({ type: 'Text', text: lineText }))?.text).toBe(lineText)
  expect((await ui.find({ type: 'Text', text: bodyText }))?.text).toBe(bodyText)
  expect(await ui.find({ type: 'Text', text: 'F2: b.go:5 is outside the PR diff, so it posts in the review body.' })).toBeDefined()

  await ui.press({ key: 'post' })
  expect(w.writes.map((x) => x.key)).toEqual(WRITES)
  expect(w.writes[1]!.args).toMatchObject({ path: 'a.go', line: 3 })
  expect(w.writes[1]!.args.body).toBe(lineText)
  expect(w.writes[2]!.args.body).toBe(bodyText)
  await ui.unmount()
})
