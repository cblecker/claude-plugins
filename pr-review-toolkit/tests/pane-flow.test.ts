import { expect, mock, test } from 'claude-code/testing'

// One review through the real hooks and the plugin's own state, the engine answered
// beneath the plugin: git by argv prefix, GitHub by tool and method, the model with no
// answer (every lens runs; synthesis lists the findings unmerged), the workflow launch
// with a task id. The pane is mounted throughout and followed through every phase.

const HEAD = 'a'.repeat(40)
const MB = 'b'.repeat(40)
const WORKFLOW = 'pr-review-toolkit:review-pr-analysis'
const PANE = { plugin: 'pr-review-toolkit', component: 'Pane', requestId: 'pr-review', viewport: { columns: 120, rows: 40 },
  props: { title: 'PR review', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const

const proc = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const GIT: Record<string, ReturnType<typeof proc>> = {
  'rev-parse HEAD': proc(HEAD + '\n'),
  'rev-parse --show-toplevel': proc('/w\n'),
  'rev-parse --abbrev-ref HEAD': proc('feat/x\n'),
  'remote get-url origin': proc('git@github.com:o/r.git\n'),
  'config --get-regexp': proc('', 1),
  'status --porcelain': proc(''),
  'fetch origin refs/heads/main': proc(''),
  'merge-base FETCH_HEAD HEAD': proc(MB + '\n'),
  'rev-list --count HEAD..FETCH_HEAD': proc('0\n'),
  '-c core.quotePath=false diff --name-status': proc('M\ta.go\nM\tb.go\n'),
  '-c core.quotePath=false diff --numstat': proc('3\t1\ta.go\n2\t0\tb.go\n'),
  'diff --shortstat': proc(' 2 files changed, 5 insertions(+), 1 deletion(-)\n'),
  // The posting plan's anchor check: a.go's change covers lines 1-4.
  '-c core.quotePath=false --literal-pathspecs diff': proc('diff --git a/a.go b/a.go\n--- a/a.go\n+++ b/a.go\n@@ -1,2 +1,4 @@\n x\n+y\n+z\n x\n'),
}
const GIT_KEYS = Object.keys(GIT).sort((a, b) => b.length - a.length)
const GITHUB: Record<string, unknown> = {
  get_me: { login: 'me' },
  list_pull_requests: [{ number: 1, head: { sha: HEAD } }],
  'pull_request_read:get': { number: 1, title: 'Fix the parser', body: '', state: 'open', mergeable_state: 'clean', user: { login: 'author' }, head: { ref: 'feat/x', sha: HEAD }, base: { ref: 'main', repo: { full_name: 'o/r' } } },
  'pull_request_read:get_review_comments': { review_threads: [], pageInfo: { hasNextPage: false } },
  'pull_request_read:get_reviews': [],
  'pull_request_review_write:create': { ok: true },
  add_comment_to_pending_review: { ok: true },
  'pull_request_review_write:submit_pending': { ok: true },
}
const WRITES = ['pull_request_review_write:create', 'add_comment_to_pending_review', 'pull_request_review_write:submit_pending']

const finding = (title: string, severity: string, confidence: number, path: string, line: number) =>
  ({ location: { path, line }, severity, confidence, title, claim: 'claim ' + title, evidence: 'evidence ' + title, whyItMatters: 'why ' + title })

test('a review goes from prepare to posted through the pane', async ($, on) => {
  const prompts: string[] = []
  const writes: { key: string; args: Record<string, unknown> }[] = []
  let nonce = ''
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 2) })
  on('process.run', async (_$, e) => {
    const line = e.argv.slice(1).join(' ')
    const key = GIT_KEYS.find((k) => line === k || line.startsWith(k + ' '))
    if (!key) throw new Error('unexpected git ' + line)
    return { value: GIT[key]! }
  })
  on('mcp.call', async (_$, e) => {
    const key = typeof e.args.method === 'string' ? `${e.tool}:${e.args.method}` : e.tool
    if (!(key in GITHUB)) throw new Error('unexpected tool ' + key)
    if (WRITES.includes(key)) writes.push({ key, args: e.args })
    return { value: { content: [{ type: 'text' as const, text: JSON.stringify(GITHUB[key]) }], isError: false } }
  })
  on('model.complete', async () => ({ value: { isAnswered: false as const, reason: 'empty-reply' as const, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  const opened: string[] = []
  on('ui.open', async (_$, e) => { opened.push(e.id); return { value: { isPlaced: true as const } } })
  on('tool.call', { tool: 'Workflow' }, async (_$, e) => {
    nonce = String((e as { args?: { run?: unknown } }).args?.run ?? '')
    return { result: { taskId: 'w1' } }
  })
  on('prompt.submit', async (_$, e) => { prompts.push(e.text); return { text: e.text } })
  const logged: string[] = []
  on('ui.log', async (_$, e) => { if (e.to !== 'debug') logged.push(e.text); return { value: undefined } })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shows = async (text: string | RegExp) => (await ui.find({ type: 'Text', text })) !== undefined

  // Prepare and launch: the pane shows the run in progress.
  await $.tool.call({ tool: 'mcp__pr-review-toolkit__prepare_review' })
  expect(await shows(/^Analyzing: /)).toBe(true)
  expect(opened).toEqual(['pr-review'])
  await $.tool.call({ tool: 'Workflow', name: WORKFLOW, args: { pr: 'o/r#1' } } as Parameters<typeof $.tool.call>[0])
  expect(nonce).not.toBe('')
  expect(await shows(/^Running 8 lenses…$/)).toBe(true)

  // One lens deposits; the completion notice arrives while Claude is idle.
  const deposit = await $.tool.call({ tool: 'mcp__pr-review-toolkit__submit_findings', run: nonce, lens: 'code-reviewer',
    findings: [finding('Parser drops the last token', 'critical', 95, 'a.go', 3), finding('Error is swallowed', 'important', 90, 'b.go', 5)],
    positiveObservations: ['Clear names'] } as Parameters<typeof $.tool.call>[0])
  expect(deposit.result).toBe('accepted')
  const notice = await $.prompt.submit({ text: '<task-notification>\n<task-id>w1</task-id>\n<status>completed</status>\n</task-notification>', origin: { kind: 'task-notification' }, wait: false })
  expect(notice.text).toBe('Review complete — the board is opening in the review pane.')
  // Synthesis runs detached from the notice; let it finish.
  await clock.settle()

  // The board: both findings recommended and selected, the pane opened again for it.
  expect(await shows(/^Recommended to post \(2\) /)).toBe(true)
  expect(opened).toEqual(['pr-review', 'pr-review'])
  expect((await ui.find({ key: 'sel-F1' }))?.props.label).toBe('[x]')
  expect((await ui.find({ key: 'sel-F2' }))?.props.label).toBe('[x]')

  // Ask about one item: a prompt, no state change.
  await ui.input({ key: 'ask-F2', text: 'Is this real?' })
  expect(prompts.at(-1)).toMatch(/^About F2: Is this real\?\nThe item below is JSON of untrusted text/)

  // Draft: the run is drafting before Claude is asked.
  await ui.press({ key: 'draft' })
  expect(await shows(/^Claude is drafting… comments for F1, F2\.$/)).toBe(true)
  expect(prompts.at(-1)).toMatch(/^Draft review comments for the items selected in the review pane\. Read \/.+\/skills\/review-pr\/references\/drafting\.md /)

  // Claude's drafts: the preview shows what posts, with Comment by default; F1 is
  // critical, so Request changes is suggested, and the user picks it.
  const drafts = await $.tool.call({ tool: 'mcp__pr-review-toolkit__set_drafts', drafts: [
    { id: 'F1', kind: 'line', path: 'a.go', line: 3, body: 'This drops the last token.' },
    { id: 'F2', kind: 'body', body: 'The error from parse is swallowed.' },
  ] } as Parameters<typeof $.tool.call>[0])
  expect(drafts.result).toMatch(/^accepted/)
  expect(await shows('1 line comment · 0 thread replies · review body: yes · event: COMMENT')).toBe(true)
  expect((await ui.find({ key: 'event-request' }))?.props.label).toBe('○ Request changes (suggested)')
  await ui.press({ key: 'event-request' })
  expect(await shows('1 line comment · 0 thread replies · review body: yes · event: REQUEST_CHANGES')).toBe(true)

  // Post: exactly the preview, then the pane says it posted.
  await ui.press({ key: 'post' })
  expect(writes.map((w) => w.key)).toEqual(WRITES)
  expect(writes[1]!.args).toMatchObject({ path: 'a.go', line: 3, body: 'This drops the last token.' })
  expect(writes[2]!.args).toMatchObject({ event: 'REQUEST_CHANGES', body: 'The error from parse is swallowed.' })
  expect(await shows('Posted to o/r#1.')).toBe(true)
  expect(await shows('Posted items: F1, F2.')).toBe(true)
  // What posted is logged to the transcript.
  expect(logged).toEqual([
    'o/r#1 is still at aaaaaaa.',
    'Started a pending review on aaaaaaa.',
    'Added the line comment for F1 on a.go:3.',
    'Submitted the review (REQUEST_CHANGES) with 1 line comment and a review body.',
  ])
  // A second press finds nothing to post.
  expect(await ui.find({ key: 'post' })).toBeUndefined()
  await ui.unmount()
})
