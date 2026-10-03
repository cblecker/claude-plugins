import { expect, test } from 'claude-code/testing'
import { prepareReview, scaleOf } from '../hooks/lib/prepare'
import type { CompleteResult, Io, McpResult, ProcResult } from '../hooks/lib/io'
import type { RunState } from '../hooks/lib/types'

const HEAD = 'a'.repeat(40)
const MB = 'b'.repeat(40)
const OLD = 'c'.repeat(40)
const SHORTSTAT = ' 1 file changed, 3 insertions(+), 1 deletion(-)\n'
const ok = (stdout: string): ProcResult => ({ exitCode: 0, stdout, stderr: '' })
const fail = (stderr: string, exitCode = 1): ProcResult => ({ exitCode, stdout: '', stderr })

// A GitHub answer: JSON for the text part, a function of the call's arguments, or a tool error.
type McpAnswer = unknown
const toolError = (text: string) => ({ toolError: text })

const prJson = (over: Record<string, unknown> = {}) => ({
  number: 1, title: 'Title', body: 'Body', state: 'open', mergeable_state: 'clean', user: { login: 'author' },
  head: { ref: 'feat/x', sha: HEAD }, base: { ref: 'main', repo: { full_name: 'o/r' } }, ...over,
})

// The checkout: branch feat/x of git@github.com:o/r.git at HEAD, clean, base main.
// Keys are matched against the git arguments by longest prefix.
const GIT: Record<string, ProcResult> = {
  'rev-parse HEAD': ok(HEAD + '\n'),
  'rev-parse --show-toplevel': ok('/w\n'),
  'rev-parse --abbrev-ref HEAD': ok('feat/x\n'),
  'remote get-url origin': ok('git@github.com:o/r.git\n'),
  'config --get-regexp': fail(''),
  'status --porcelain': ok(''),
  'fetch origin refs/heads/main': ok(''),
  'merge-base FETCH_HEAD HEAD': ok(MB + '\n'),
  'rev-list --count HEAD..FETCH_HEAD': ok('2\n'),
  '-c core.quotePath=false diff --name-status': ok('M\ta.go\n'),
  '-c core.quotePath=false diff --numstat': ok('3\t1\ta.go\n'),
  'diff --shortstat': ok(SHORTSTAT),
  // computeDelta
  'merge-base --is-ancestor': ok(''),
  'rev-list --count': ok('2\n'),
  '-c core.quotePath=false --literal-pathspecs diff': ok('diff --git a/a.go b/a.go\n--- a/a.go\n+++ b/a.go\n@@ -3,0 +4,2 @@\n+x\n+y\n'),
}

// GitHub: PR #1 is the branch's one open PR; the reviewer is `me`; no threads or reviews.
const MCP: Record<string, McpAnswer> = {
  get_me: { login: 'me' },
  list_pull_requests: [{ number: 1, head: { sha: HEAD } }],
  'pull_request_read:get': prJson(),
  'pull_request_read:get_review_comments': { review_threads: [], pageInfo: { hasNextPage: false } },
  'pull_request_read:get_reviews': [],
}

// The model picks pr-test-analyzer and reports a shape whose counts are wrong on purpose:
// the run's counts come from git's shortstat.
const SELECTION = JSON.stringify({
  lenses: [{ name: 'pr-test-analyzer', rationale: 'tests' }],
  shape: { fileCount: 99, additions: 999, deletions: 999, notableAreas: ['a.go'] },
})

type World = { git?: Record<string, ProcResult>; mcp?: Record<string, McpAnswer>; complete?: CompleteResult }

function world(over: World = {}) {
  const git = { ...GIT, ...over.git }
  const mcp = { ...MCP, ...over.mcp }
  const keys = Object.keys(git).sort((a, b) => b.length - a.length)
  const runs: { line: string; cwd?: string }[] = []
  const tools: { key: string; args: Record<string, unknown> }[] = []
  const io: Io = {
    run: async (argv, opts) => {
      if (argv[0] !== 'git') throw new Error(`unexpected command ${argv.join(' ')}`)
      const line = argv.slice(1).join(' ')
      runs.push({ line, cwd: opts?.cwd })
      const key = keys.find((k) => line === k || line.startsWith(k + ' '))
      if (!key) throw new Error(`unexpected git ${line}`)
      return git[key]!
    },
    mcp: async (tool, args): Promise<McpResult> => {
      const key = typeof args.method === 'string' ? `${tool}:${args.method}` : tool
      tools.push({ key, args })
      if (!(key in mcp)) throw new Error(`unexpected tool ${key}`)
      const entry = mcp[key]
      const v = typeof entry === 'function' ? (entry as (a: Record<string, unknown>) => unknown)(args) : entry
      if (v && typeof v === 'object' && 'toolError' in v) return { isError: true, content: [{ type: 'text', text: String((v as { toolError: unknown }).toolError) }] }
      return { content: [{ type: 'text', text: JSON.stringify(v) }] }
    },
    complete: async () => over.complete ?? { isAnswered: true, text: SELECTION },
  }
  return { io, runs, tools, called: (key: string) => tools.some((t) => t.key === key), ran: (prefix: string) => runs.some((r) => r.line.startsWith(prefix)) }
}

async function prepared(over: World = {}, existing: RunState | null = null): Promise<RunState> {
  const out = await prepareReview(world(over).io, existing)
  if ('error' in out) throw new Error(`expected a run, got: ${out.error}`)
  return out.run
}
async function failure(w: ReturnType<typeof world>, existing: RunState | null = null): Promise<string> {
  const out = await prepareReview(w.io, existing)
  if (!('error' in out)) throw new Error('expected an error, got a run')
  return out.error
}

const THREADS_FAILED = 'Existing review threads could not be collected, so overlap classification and verdicts on your earlier threads are unavailable, and recommended findings may duplicate existing comments.'
const REVIEWS_FAILED = 'Your submitted reviews could not be read, so asks made only in a review summary are not checked.'

// ---- the happy path ----

test('prepares the whole run: PR, pinned range, lenses, summary, empty review state', async () => {
  const w = world()
  const out = await prepareReview(w.io, null)
  expect('run' in out).toBe(true)
  const run = (out as { run: RunState }).run
  expect(run).toEqual({
    handle: 'o/r#1', phase: 'progress', warnings: [],
    pr: { owner: 'o', repo: 'r', number: 1, title: 'Title', body: 'Body', author: 'author', state: 'open', baseRef: 'main', headSha: HEAD, mergeableState: 'clean', baseRepo: 'o/r' },
    checkoutPath: '/w', mergeBase: MB, baseAheadCount: 2, reviewerLogin: 'me',
    diff: { nameStatus: 'M\ta.go\n', numstat: '3\t1\ta.go\n', shortstat: SHORTSTAT },
    summary: { scale: 'small', changedFileCount: 1, additions: 3, deletions: 1, notableAreas: ['a.go'], shapeUnavailable: false },
    lenses: [
      { name: 'code-reviewer', effort: 'high', rationale: 'General correctness always runs.' },
      { name: 'pr-test-analyzer', effort: 'high', rationale: 'tests' },
    ],
    lensSource: 'selector',
    threads: [], threadCollectionFailed: false, reviews: [], reviewsCollectionFailed: false,
    followUp: null,
    deposits: {}, verdicts: null, selected: [], drafts: [], event: null, posted: [],
  })
  // Not launched: no nonce and no task until the launch hook sets them.
  expect('run' in run).toBe(false)
  expect('taskId' in run).toBe(false)
  // The base is fetched and the range pinned in the checkout root.
  expect(w.runs.find((r) => r.line === 'fetch origin refs/heads/main')!.cwd).toBe('/w')
  expect(w.called('get_me')).toBe(true)
  expect(w.tools.find((t) => t.key === 'pull_request_read:get_reviews')!.args.owner).toBe('o')
})

// ---- R1: a run in flight is never replaced ----

test('refuses while a launched run is in progress, without touching git or GitHub', async () => {
  const w = world()
  const existing = { ...(await prepared()), run: 'rx', taskId: 't1' }
  expect(await failure(w, existing)).toBe('A review run is already in progress for o/r#1; cancel it in the review pane first.')
  expect(w.runs.length).toBe(0)
  expect(w.tools.length).toBe(0)
})

test('refuses while a review is being posted, without touching git or GitHub', async () => {
  const w = world()
  const existing: RunState = { ...(await prepared()), run: 'rx', taskId: 't1', phase: 'posting' }
  expect(await failure(w, existing)).toBe('The review of o/r#1 is being posted; wait for posting to finish.')
  expect(w.runs.length).toBe(0)
  expect(w.tools.length).toBe(0)
})

test('replaces a finished run or one that was prepared but never launched', async () => {
  const before = await prepared()
  expect((await prepared({}, { ...before, run: 'rx', taskId: 't1', phase: 'board' })).phase).toBe('progress')
  expect((await prepared({}, before)).handle).toBe('o/r#1')
})

// ---- each check ----

test('a checkout git cannot read is an error naming git\'s complaint', async () => {
  const w = world({ git: { 'rev-parse HEAD': fail('fatal: not a git repository (or any of the parent directories): .git', 128) } })
  const e = await failure(w)
  expect(e).toMatch(/not a git repository/)
  expect(e).toContain('Run /pr-review-toolkit:review-pr from a git checkout of the PR head')
  expect(w.tools.length).toBe(0)
})

test('a PR that cannot be resolved returns the resolver\'s error verbatim', async () => {
  const w = world({ git: { 'remote get-url origin': ok('https://gitlab.com/o/r.git\n') } })
  expect(await failure(w)).toBe('origin https://gitlab.com/o/r.git is not a github.com repository')
})

test('a PR read that fails names the PR and GitHub\'s error', async () => {
  const e = await failure(world({ mcp: { 'pull_request_read:get': toolError('Not Found') } }))
  expect(e).toMatch(/o\/r#1/)
  expect(e).toMatch(/Not Found/)
})

test('a head that differs from the checkout stops with the push or fetch fix', async () => {
  const w = world({ mcp: { 'pull_request_read:get': prJson({ head: { ref: 'feat/x', sha: OLD } }) } })
  const e = await failure(w)
  expect(e).toMatch(new RegExp(HEAD))
  expect(e).toMatch(new RegExp(OLD))
  expect(e).toMatch(/push/)
  expect(e).toMatch(/fetch/)
  expect(e).toContain('then run /pr-review-toolkit:review-pr again.')
  expect(w.ran('fetch')).toBe(false)
})

test('a PR that is not open stops', async () => {
  expect(await failure(world({ mcp: { 'pull_request_read:get': prJson({ state: 'closed' }) } }))).toMatch(/o\/r#1 is closed/)
})

test('an origin that is not the PR\'s base repository stops (R18), compared without case', async () => {
  const e = await failure(world({ mcp: { 'pull_request_read:get': prJson({ base: { ref: 'main', repo: { full_name: 'upstream/r' } } }) } }))
  expect(e).toMatch(/upstream\/r/)
  expect(e).toMatch(/o\/r/)
  expect(e).toMatch(/git remote set-url origin/)
  expect(e).toContain('and run /pr-review-toolkit:review-pr again.')
  expect((await prepared({ mcp: { 'pull_request_read:get': prJson({ base: { ref: 'main', repo: { full_name: 'O/R' } } }) } })).pr.baseRepo).toBe('O/R')
})

test('a base ref with unexpected characters stops before any fetch', async () => {
  const w = world({ mcp: { 'pull_request_read:get': prJson({ base: { ref: 'main;x', repo: { full_name: 'o/r' } } }) } })
  expect(await failure(w)).toMatch(/unexpected characters/)
  expect(w.ran('fetch')).toBe(false)
})

test('a failed base fetch quotes git; a failed merge-base suggests unshallowing', async () => {
  expect(await failure(world({ git: { 'fetch origin refs/heads/main': fail("fatal: couldn't find remote ref refs/heads/main", 128) } })))
    .toMatch(/couldn't find remote ref refs\/heads\/main/)
  expect(await failure(world({ git: { 'merge-base FETCH_HEAD HEAD': fail('fatal: no merge base') } }))).toMatch(/--unshallow/)
})

// ---- warnings ----

test('uncommitted changes warn but do not block', async () => {
  const run = await prepared({ git: { 'status --porcelain': ok(' M a.go\n?? new.go\n') } })
  expect(run.warnings).toEqual(['Uncommitted changes are present; file reads see them, the diff does not.'])
})

test('a failed get_me leaves the login empty, skips the reviews read and says follow-up is unavailable', async () => {
  const w = world({ mcp: { get_me: toolError('Bad credentials') } })
  const out = await prepareReview(w.io, null)
  const run = (out as { run: RunState }).run
  expect(run.reviewerLogin).toBe('')
  expect(run.followUp).toBe(null)
  expect(run.reviewsCollectionFailed).toBe(false)
  expect(w.called('pull_request_read:get_reviews')).toBe(false)
  expect(run.warnings).toEqual(['Your GitHub login could not be read (get_me failed), so follow-up detection is unavailable this run.'])
})

test('on the reviewer\'s own PR the login is kept but reviews are not read', async () => {
  const w = world({ mcp: { get_me: { login: 'Author' } } })
  const run = (await prepareReview(w.io, null) as { run: RunState }).run
  expect(run.reviewerLogin).toBe('Author')
  expect(run.followUp).toBe(null)
  expect(w.called('pull_request_read:get_reviews')).toBe(false)
  expect(run.warnings).toEqual([])
})

test('threads that could not be read at all are flagged and warned', async () => {
  const run = await prepared({ mcp: { 'pull_request_read:get_review_comments': toolError('boom') } })
  expect(run.threads).toEqual([])
  expect(run.threadCollectionFailed).toBe(true)
  expect(run.warnings).toEqual([THREADS_FAILED])
})

test('a partial thread read keeps the threads it got and warns (R19)', async () => {
  const page = {
    review_threads: [{ id: 'T1', is_resolved: false, is_outdated: false, total_count: 3,
      comments: [{ body: 'b', path: 'a.go', line: 3, author: 'x', html_url: 'https://github.com/o/r/pull/1#discussion_r5' }] }],
    pageInfo: { hasNextPage: false },
  }
  const run = await prepared({ mcp: { 'pull_request_read:get_review_comments': page } })
  expect(run.threads.map((t) => t.id)).toEqual(['T1'])
  expect(run.threadCollectionFailed).toBe(true)
  expect(run.warnings).toEqual(['Review threads may be incomplete.'])
})

test('reviews that could not be read at all are flagged and warned', async () => {
  const run = await prepared({ mcp: { 'pull_request_read:get_reviews': toolError('boom') } })
  expect(run.reviews).toEqual([])
  expect(run.reviewsCollectionFailed).toBe(true)
  expect(run.warnings).toEqual([REVIEWS_FAILED])
})

test('a partial reviews read keeps the reviews it got and warns (R19)', async () => {
  // Every page is full, so the read stops at its page cap.
  const fullPage = () => Array.from({ length: 100 }, (_, i) => ({
    id: i, state: 'COMMENTED', body: '', user: { login: i === 0 ? 'me' : 'other' }, commit_id: OLD, submitted_at: '2026-01-01T00:00:00Z',
  }))
  const run = await prepared({ mcp: { 'pull_request_read:get_reviews': fullPage } })
  expect(run.reviews.length).toBe(20)
  expect(run.reviewsCollectionFailed).toBe(true)
  expect(run.warnings).toEqual(['Your earlier reviews could not be read completely.'])
})

// ---- follow-up ----

test('a reviewer with an earlier review gets a follow-up context and the delta since it', async () => {
  const w = world({ mcp: {
    'pull_request_read:get_review_comments': {
      review_threads: [{ id: 'T1', is_resolved: false, is_outdated: false, comments: [{ body: 'please fix', path: 'a.go', line: 3, author: 'me', html_url: 'https://github.com/o/r/pull/1#discussion_r7' }] }],
      pageInfo: { hasNextPage: false },
    },
    'pull_request_read:get_reviews': [{ id: 1, state: 'CHANGES_REQUESTED', body: 'fix it', user: { login: 'me' }, commit_id: OLD, submitted_at: '2026-01-01T00:00:00Z' }],
  } })
  const run = (await prepareReview(w.io, null) as { run: RunState }).run
  const f = run.followUp!
  expect(f.reviewedCommit).toBe(OLD)
  expect(f.reviewState).toBe('CHANGES_REQUESTED')
  expect(f.threads.map((t) => t.id)).toEqual(['T1'])
  expect(f.reviewSummaries).toEqual([{ state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01T00:00:00Z', body: 'fix it' }])
  expect(f.delta).toEqual({ available: true, commitsSince: 2, files: [{ path: 'a.go', hunks: [[4, 5]] }] })
  const anc = w.runs.find((r) => r.line.startsWith('merge-base --is-ancestor'))!
  expect(anc.line).toBe(`merge-base --is-ancestor ${OLD} ${HEAD}`)
  expect(anc.cwd).toBe('/w')
})

test('a follow-up without a reviewed commit has no delta and runs no delta git', async () => {
  const w = world({ mcp: {
    'pull_request_read:get_review_comments': {
      review_threads: [{ id: 'T1', comments: [{ body: 'ask', path: 'a.go', line: 3, author: 'me', html_url: 'https://github.com/o/r/pull/1#discussion_r7' }] }],
      pageInfo: { hasNextPage: false },
    },
  } })
  const run = (await prepareReview(w.io, null) as { run: RunState }).run
  expect(run.followUp!.reviewedCommit).toBe('')
  expect(run.followUp!.delta).toEqual({ available: false })
  expect(w.ran('merge-base --is-ancestor')).toBe(false)
})

// ---- summary and lens selection ----

test('the summary counts come from git\'s shortstat; notable areas from the model', async () => {
  const run = await prepared({ git: { 'diff --shortstat': ok(' 30 files changed, 100 insertions(+), 5 deletions(-)\n') } })
  expect(run.summary).toEqual({ scale: 'medium', changedFileCount: 30, additions: 100, deletions: 5, notableAreas: ['a.go'], shapeUnavailable: false })
})

test('a failed selection runs every lens and still reports the counts', async () => {
  const run = await prepared({ complete: { isAnswered: true, text: 'not json' } })
  expect(run.lensSource).toBe('all-lenses-fallback')
  expect(run.lenses.length).toBe(8)
  expect(run.lenses[0]!.name).toBe('code-reviewer')
  expect(run.summary).toEqual({ scale: 'small', changedFileCount: 1, additions: 3, deletions: 1, notableAreas: [], shapeUnavailable: false })
})

test('scaleOf follows the workflow\'s thresholds on files and churn', () => {
  expect(scaleOf(20, 1000)).toBe('small')
  expect(scaleOf(21, 0)).toBe('medium')
  expect(scaleOf(0, 1001)).toBe('medium')
  expect(scaleOf(76, 0)).toBe('large')
  expect(scaleOf(0, 5001)).toBe('large')
  expect(scaleOf(251, 0)).toBe('very_large')
  expect(scaleOf(0, 20001)).toBe('very_large')
})
