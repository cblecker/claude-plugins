import type { On, PaneOpenArgs } from 'claude-code'

// The engine beneath the plugin for the pane's mounted tests: a checkout of o/r#1 at
// HEAD (git answered by argv prefix), its GitHub side with no threads or reviews and
// accepting every review write (answered by tool and method), a model that never
// answers (every lens runs; synthesis lists findings unmerged), and recorders for what
// the plugin opens, writes, asks Claude, logs and toasts.

export const HEAD = 'a'.repeat(40)
export const MB = 'b'.repeat(40)

export const PANE = { plugin: 'pr-review-toolkit', component: 'Pane', requestId: 'pr-review', viewport: { columns: 120, rows: 40 },
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

export const WRITES = ['pull_request_review_write:create', 'add_comment_to_pending_review', 'pull_request_review_write:submit_pending']
const GITHUB: Record<string, unknown> = {
  get_me: { login: 'me' },
  list_pull_requests: [{ number: 1, head: { sha: HEAD } }],
  'pull_request_read:get': { number: 1, title: 'Fix the parser', body: '', state: 'open', mergeable_state: 'clean', user: { login: 'author' }, head: { ref: 'feat/x', sha: HEAD }, base: { ref: 'main', repo: { full_name: 'o/r' } } },
  'pull_request_read:get_review_comments': { review_threads: [], pageInfo: { hasNextPage: false } },
  'pull_request_read:get_reviews': [],
  ...Object.fromEntries(WRITES.map((key) => [key, { ok: true }])),
}

export type World = {
  opened: PaneOpenArgs[]; writes: { key: string; args: Record<string, unknown> }[]
  prompts: string[]; logged: string[]; toasts: string[]
}

// `placed: false` answers every pane open as a narrow terminal does: open, not drawn.
// `hold`: a promise every review write waits for before it is answered (a post that is
// still in flight until the test lets it go); `holdModel`: the same for every model call
// made while its `current` is set (a synthesis that is still being built).
export function world(on: On, opts: { placed?: boolean; hold?: Promise<unknown>; holdModel?: { current?: Promise<unknown> } } = {}): World {
  const w: World = { opened: [], writes: [], prompts: [], logged: [], toasts: [] }
  on('process.run', async (_$, e) => {
    const line = e.argv.slice(1).join(' ')
    const key = GIT_KEYS.find((k) => line === k || line.startsWith(k + ' '))
    if (!key) throw new Error('unexpected git ' + line)
    return { value: GIT[key]! }
  })
  on('mcp.call', async (_$, e) => {
    const key = typeof e.args.method === 'string' ? `${e.tool}:${e.args.method}` : e.tool
    if (!(key in GITHUB)) throw new Error('unexpected tool ' + key)
    if (WRITES.includes(key)) { w.writes.push({ key, args: e.args }); await opts.hold }
    return { value: { content: [{ type: 'text' as const, text: JSON.stringify(GITHUB[key]) }], isError: false } }
  })
  on('model.complete', async () => (await opts.holdModel?.current, { value: { isAnswered: false as const, reason: 'empty-reply' as const, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }))
  on('ui.open', async (_$, e) => {
    w.opened.push(e)
    return { value: opts.placed === false ? { isPlaced: false as const, reason: 'the terminal is 100 columns wide; an unasked pane needs 144' } : { isPlaced: true as const } }
  })
  on('prompt.submit', async (_$, e) => { w.prompts.push(e.text); return { text: e.text } })
  on('ui.log', async (_$, e) => { if (e.to !== 'debug') w.logged.push(e.text); return { value: undefined } })
  on('ui.toast', async (_$, e) => { w.toasts.push(e.text); return { value: undefined } })
  return w
}
