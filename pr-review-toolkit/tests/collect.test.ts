import { expect, test } from 'claude-code/testing'
import { git, pinRange, readEnvironment } from '../hooks/lib/git'
import {
  collectReviews, collectThreads, fetchPr, parseOwnerRepo, parseShortstat, prFromMergeConfig,
  resolvePr, stripOriginCredentials, toReview, toThread,
} from '../hooks/lib/github'
import type { Io, McpResult, ProcResult } from '../hooks/lib/io'

const ref = { owner: 'o', repo: 'r', number: 1 }

// An Io whose unlisted methods must not be reached.
function ioWith(parts: Partial<Io>): Io {
  return {
    run: async () => { throw new Error('run is not part of this call') },
    mcp: async () => { throw new Error('mcp is not part of this call') },
    complete: async () => { throw new Error('complete is not part of this call') },
    ...parts,
  }
}
const textResult = (v: unknown): McpResult => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
const ok = (stdout: string): ProcResult => ({ exitCode: 0, stdout, stderr: '' })
const fail = (stderr: string, exitCode = 1): ProcResult => ({ exitCode, stdout: '', stderr })

type McpCall = { tool: string; args: Record<string, unknown> }
type RunCall = { argv: string[]; opts?: { cwd?: string; timeoutMs?: number } }

// Real get_review_comments shapes, observed on cblecker/claude-plugins PRs 108 and 109
// (bodies trimmed): snake_case thread flags, author as a login string, no numeric
// comment id (it is the discussion_r anchor in html_url), and `line` absent when outdated.
const currentThread = {
  id: 'PRRT_kwDOQ_U6rc6nN8ZJ', is_resolved: true, is_outdated: false, is_collapsed: true, total_count: 2,
  comments: [
    { body: 'The re-approval instructions skip the anchor check.', path: 'pr-review-toolkit/skills/review-pr/references/posting.md', line: 91, original_line: 91, start_line: 90, original_start_line: 90, author: 'copilot-pull-request-reviewer', created_at: '2026-09-29T17:22:16Z', updated_at: '2026-09-29T17:22:17Z', html_url: 'https://github.com/cblecker/claude-plugins/pull/109#discussion_r4136354623' },
    { body: 'Valid. Fixed in 59bd6e4.', path: 'pr-review-toolkit/skills/review-pr/references/posting.md', line: 91, original_line: 91, start_line: 90, original_start_line: 90, author: 'cblecker', created_at: '2026-09-29T17:23:00Z', updated_at: '2026-09-29T17:23:01Z', html_url: 'https://github.com/cblecker/claude-plugins/pull/109#discussion_r4136361159' },
  ],
}
const outdatedThread = {
  id: 'PRRT_kwDOQ_U6rc6mX8VL', is_resolved: true, is_outdated: true, is_collapsed: true, total_count: 2,
  comments: [
    { body: '`deltaAvailable` is also false when no submitted-review commit exists.', path: 'pr-review-toolkit/skills/review-pr/references/board.md', original_line: 64, original_start_line: 61, author: 'copilot-pull-request-reviewer', created_at: '2026-09-27T06:24:36Z', updated_at: '2026-09-27T06:24:37Z', html_url: 'https://github.com/cblecker/claude-plugins/pull/108#discussion_r4114328079' },
    { body: 'Fixed in a080981.', path: 'pr-review-toolkit/skills/review-pr/references/board.md', original_line: 64, original_start_line: 61, author: 'cblecker', created_at: '2026-09-27T06:28:29Z', updated_at: '2026-09-27T06:28:29Z', html_url: 'https://github.com/cblecker/claude-plugins/pull/108#discussion_r4114335956' },
  ],
}
const pageInfo = (hasNextPage: boolean, endCursor?: string) => ({ hasNextPage, hasPreviousPage: false, startCursor: 'S', ...(endCursor ? { endCursor } : {}) })

// A minimal thread in the observed shape.
const thread = (id: string, n: number) => ({ id, is_resolved: false, is_outdated: false, comments: [{ body: `b${n}`, path: `f${n}.go`, line: n, original_line: n, author: 'x', html_url: `https://github.com/o/r/pull/1#discussion_r${n}` }] })

// Real get_reviews item, observed on PR 112 (body trimmed).
const reviewItem = (login: string, id: number, body = 'overview') => ({
  id, state: 'COMMENTED', body, html_url: `https://github.com/o/r/pull/1#pullrequestreview-${id}`,
  user: { login, id: 175728472, profile_url: `https://github.com/apps/${login}`, avatar_url: 'https://avatars.githubusercontent.com/in/946600?v=4' },
  commit_id: `sha${id}`, submitted_at: '2026-10-02T02:44:03Z', author_association: 'NONE',
})

// ---- pure helpers ----

test('parses owner/repo from ssh and https origins', () => {
  expect(parseOwnerRepo('git@github.com:cblecker/claude-plugins.git')).toEqual({ owner: 'cblecker', repo: 'claude-plugins' })
  expect(parseOwnerRepo('https://github.com/cblecker/dp-check')).toEqual({ owner: 'cblecker', repo: 'dp-check' })
  expect(parseOwnerRepo('https://github.com/cblecker/dp-check.git/')).toEqual({ owner: 'cblecker', repo: 'dp-check' })
  expect(parseOwnerRepo('ssh://git@github.com/cblecker/dp-check.git')).toEqual({ owner: 'cblecker', repo: 'dp-check' })
  expect(parseOwnerRepo('https://gitlab.com/x/y.git')).toBe(null)
})

test('parseOwnerRepo reads a URL whose password holds an @ and still requires the host', () => {
  expect(parseOwnerRepo('https://user:p@ss@github.com/o/r.git')).toEqual({ owner: 'o', repo: 'r' })
  expect(parseOwnerRepo('https://github.com@evil.com/o/r')).toBe(null)
})

test('parseOwnerRepo requires github.com as the whole host', () => {
  expect(parseOwnerRepo('https://notgithub.com/x/y')).toBe(null)
  expect(parseOwnerRepo('https://gitlab.com/github.com/y')).toBe(null)
  expect(parseOwnerRepo('')).toBe(null)
})

test('stripOriginCredentials drops userinfo from URL origins and leaves scp-style ones alone', () => {
  expect(stripOriginCredentials('https://user:tok3n@github.com/o/r.git')).toBe('https://github.com/o/r.git')
  expect(stripOriginCredentials('https://tok3n@github.com/o/r')).toBe('https://github.com/o/r')
  expect(stripOriginCredentials('https://user:p@ss@github.com/o/r.git')).toBe('https://github.com/o/r.git')
  expect(stripOriginCredentials('https://github.com/o/r@v1')).toBe('https://github.com/o/r@v1')
  expect(stripOriginCredentials('git@github.com:o/r.git')).toBe('git@github.com:o/r.git')
  expect(stripOriginCredentials('https://github.com/o/r')).toBe('https://github.com/o/r')
})

test('reads a gh-pr-checkout merge ref', () => {
  expect(prFromMergeConfig('branch.pr-50.merge refs/pull/50/head\n', 'pr-50')).toBe(50)
  expect(prFromMergeConfig('branch.main.merge refs/heads/main\n', 'main')).toBe(null)
})

test('prFromMergeConfig matches the named branch exactly, slashes and dots included', () => {
  const config = 'branch.main.merge refs/heads/main\nbranch.fix/a.b.merge refs/pull/7/head\nbranch.pr-70.merge refs/pull/70/head\n'
  expect(prFromMergeConfig(config, 'fix/a.b')).toBe(7)
  expect(prFromMergeConfig(config, 'pr-7')).toBe(null)
  expect(prFromMergeConfig('', 'main')).toBe(null)
})

test('parseShortstat handles missing parts', () => {
  expect(parseShortstat(' 3 files changed, 10 insertions(+)')).toEqual({ fileCount: 3, additions: 10, deletions: 0 })
  expect(parseShortstat(' 1 file changed, 1 insertion(+), 2 deletions(-)')).toEqual({ fileCount: 1, additions: 1, deletions: 2 })
  expect(parseShortstat('')).toEqual({ fileCount: 0, additions: 0, deletions: 0 })
})

test('toThread maps a current-line thread from the observed shape', () => {
  expect(toThread(currentThread)).toEqual({
    id: 'PRRT_kwDOQ_U6rc6nN8ZJ',
    commentId: 4136354623,
    path: 'pr-review-toolkit/skills/review-pr/references/posting.md',
    line: 91,
    originalLine: 91,
    author: 'copilot-pull-request-reviewer',
    body: 'The re-approval instructions skip the anchor check.',
    isResolved: true,
    isOutdated: false,
    replies: [{ author: 'cblecker', body: 'Valid. Fixed in 59bd6e4.' }],
  })
})

test('toThread keeps original_line when an outdated comment has no line', () => {
  const t = toThread(outdatedThread)!
  expect(t.line).toBeUndefined()
  expect(t.originalLine).toBe(64)
  expect(t.isOutdated).toBe(true)
  expect(t.commentId).toBe(4114328079)
})

test('toThread leaves unexposed state and an unparsable anchor undefined', () => {
  const t = toThread({ id: 'T', comments: [{ body: 'b', path: 'a.go', author: { login: 'obj' }, html_url: 'https://example.com/none' }] })!
  expect(t.commentId).toBeUndefined()
  expect(t.isResolved).toBeUndefined()
  expect(t.isOutdated).toBeUndefined()
  expect(t.author).toBe('obj')
  expect(t.replies).toEqual([])
})

test('toThread rejects a thread without an id or comments', () => {
  expect(toThread(null)).toBe(null)
  expect(toThread({ comments: [{ body: 'b' }] })).toBe(null)
  expect(toThread({ id: 'T', comments: [] })).toBe(null)
  expect(toThread({ id: 'T' })).toBe(null)
})

test('toReview maps the observed get_reviews shape', () => {
  expect(toReview(reviewItem('cblecker', 9, 'LGTM'))).toEqual({
    author: 'cblecker', state: 'COMMENTED', commitId: 'sha9', submittedAt: '2026-10-02T02:44:03Z', body: 'LGTM',
  })
  expect(toReview({ user: { login: 'a' }, state: 'APPROVED' }).body).toBe('')
})

// ---- collectThreads ----

test('collectThreads follows the after cursor across pages', async () => {
  const calls: McpCall[] = []
  const pages = [
    { review_threads: [thread('T1', 11)], totalCount: 2, pageInfo: pageInfo(true, 'C1') },
    { review_threads: [thread('T2', 22)], totalCount: 2, pageInfo: pageInfo(false, 'C2') },
  ]
  const io = ioWith({ mcp: async (tool, args) => { calls.push({ tool, args }); return textResult(args.after === 'C1' ? pages[1] : pages[0]) } })
  const out = await collectThreads(io, ref)
  expect(out.failed).toBe(false)
  expect(out.threads.map((t) => t.id)).toEqual(['T1', 'T2'])
  expect(out.threads.map((t) => t.commentId)).toEqual([11, 22])
  expect(calls.length).toBe(2)
  expect(calls[0]!.tool).toBe('pull_request_read')
  expect(calls[0]!.args).toEqual({ method: 'get_review_comments', owner: 'o', repo: 'r', pullNumber: 1, perPage: 100 })
  expect(calls[1]!.args.after).toBe('C1')
})

test('collectThreads reports zero threads as a successful read', async () => {
  const io = ioWith({ mcp: async () => textResult({ review_threads: [], totalCount: 0, pageInfo: pageInfo(false) }) })
  expect(await collectThreads(io, ref)).toEqual({ threads: [], failed: false })
})

test('collectThreads reports a thread cut short of its total_count as incomplete but keeps what it read', async () => {
  const cut = { ...thread('T1', 1), total_count: 3 }
  const io = ioWith({
    mcp: async (_tool, args) => textResult(args.after
      ? { review_threads: [thread('T2', 2)], pageInfo: pageInfo(false) }
      : { review_threads: [cut], pageInfo: pageInfo(true, 'C1') }),
  })
  const out = await collectThreads(io, ref)
  expect(out.failed).toBe(true)
  expect(out.threads.map((t) => t.id)).toEqual(['T1', 'T2'])
})

test('collectThreads treats a thread holding all its comments as complete', async () => {
  const io = ioWith({ mcp: async () => textResult({ review_threads: [currentThread, outdatedThread], totalCount: 2, pageInfo: pageInfo(false) }) })
  const out = await collectThreads(io, ref)
  expect(out.failed).toBe(false)
  expect(out.threads.length).toBe(2)
})

test('collectThreads skips threads it cannot map', async () => {
  const io = ioWith({ mcp: async () => textResult({ review_threads: [thread('T1', 1), { id: 'empty', comments: [] }], pageInfo: pageInfo(false) }) })
  const out = await collectThreads(io, ref)
  expect(out.threads.map((t) => t.id)).toEqual(['T1'])
  expect(out.failed).toBe(false)
})

test('collectThreads fails on a tool error, a throw, unparsable text, or the wrong shape', async () => {
  const cases: Array<() => Promise<McpResult>> = [
    async () => ({ isError: true, content: [{ type: 'text', text: 'rate limited' }] }),
    async () => { throw new Error('boom') },
    async () => textResult('not json'),
    async () => ({ content: [] }),
    async () => textResult('null'),
    async () => textResult({}),
    async () => textResult({ threads: [thread('T1', 1)], pageInfo: pageInfo(false) }),
  ]
  for (const mcp of cases) expect(await collectThreads(ioWith({ mcp }), ref)).toEqual({ threads: [], failed: true })
})

test('collectThreads fails when a later page breaks, keeping the pages already read (R19)', async () => {
  const later: Array<() => Promise<McpResult>> = [
    async () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] }),
    async () => { throw new Error('boom') },
    async () => textResult('not json'),
    async () => textResult({ threads: [thread('T2', 2)], pageInfo: pageInfo(false) }),
  ]
  for (const page2 of later) {
    const io = ioWith({
      mcp: async (_tool, args) => args.after ? page2() : textResult({ review_threads: [thread('T1', 1)], pageInfo: pageInfo(true, 'C1') }),
    })
    const out = await collectThreads(io, ref)
    expect(out.failed).toBe(true)
    expect(out.threads.map((t) => t.id)).toEqual(['T1'])
  }
})

test('collectThreads fails instead of looping when the cursor is missing or stuck', async () => {
  let n = 0
  const missing = ioWith({ mcp: async () => { n++; return textResult({ review_threads: [thread('T1', 1)], pageInfo: pageInfo(true) }) } })
  expect((await collectThreads(missing, ref)).failed).toBe(true)
  expect(n).toBe(1)

  n = 0
  const stuck = ioWith({ mcp: async () => { n++; return textResult({ review_threads: [thread('T1', 1)], pageInfo: pageInfo(true, 'SAME') }) } })
  expect((await collectThreads(stuck, ref)).failed).toBe(true)
  expect(n).toBe(2)
})

test('collectThreads stops at the page cap and reports failure', async () => {
  let n = 0
  const io = ioWith({ mcp: async () => { n++; return textResult({ review_threads: [thread(`T${n}`, n)], pageInfo: pageInfo(true, `C${n}`) }) } })
  const out = await collectThreads(io, ref)
  expect(out.failed).toBe(true)
  expect(n).toBe(50)
})

// ---- collectReviews ----

test('collectReviews pages by number, keeps only the exact login, and stops at the short page', async () => {
  const calls: McpCall[] = []
  const page1 = Array.from({ length: 100 }, (_, i) => reviewItem(i === 0 ? 'me' : i === 1 ? 'coderabbitai[bot]' : 'other', i + 1))
  const page2 = [reviewItem('me', 101), reviewItem('me-too', 102), reviewItem('Me', 103)]
  const io = ioWith({ mcp: async (tool, args) => { calls.push({ tool, args }); return textResult(args.page === 2 ? page2 : page1) } })
  const out = await collectReviews(io, ref, 'me')
  expect(out.failed).toBe(false)
  expect(out.reviews.map((r) => r.commitId)).toEqual(['sha1', 'sha101'])
  expect(calls.map((c) => c.args.page)).toEqual([1, 2])
  expect(calls[0]!.tool).toBe('pull_request_read')
  expect(calls[0]!.args).toEqual({ method: 'get_reviews', owner: 'o', repo: 'r', pullNumber: 1, perPage: 100, page: 1 })
})

test('collectReviews makes no call without a login', async () => {
  expect(await collectReviews(ioWith({}), ref, '')).toEqual({ reviews: [], failed: false })
})

test('collectReviews returns an empty list when the reviewer has not reviewed', async () => {
  const io = ioWith({ mcp: async () => textResult([reviewItem('coderabbitai[bot]', 1)]) })
  expect(await collectReviews(io, ref, 'me')).toEqual({ reviews: [], failed: false })
})

test('collectReviews fails on a tool error, a throw, unparsable text, or a non-list result', async () => {
  const cases: Array<() => Promise<McpResult>> = [
    async () => ({ isError: true, content: [{ type: 'text', text: 'nope' }] }),
    async () => { throw new Error('boom') },
    async () => textResult('not json'),
    async () => textResult('null'),
    async () => textResult({ message: 'Not Found' }),
  ]
  for (const mcp of cases) expect(await collectReviews(ioWith({ mcp }), ref, 'me')).toEqual({ reviews: [], failed: true })
})

test('collectReviews reports failure when the page cap cuts the list short', async () => {
  let n = 0
  const full = Array.from({ length: 100 }, (_, i) => reviewItem('other', i + 1))
  const io = ioWith({ mcp: async () => { n++; return textResult(full) } })
  expect((await collectReviews(io, ref, 'me')).failed).toBe(true)
  expect(n).toBe(20)
})

// ---- fetchPr ----

test('fetchPr maps the observed get shape and strips HTML comments from the body', async () => {
  const calls: McpCall[] = []
  const io = ioWith({
    mcp: async (tool, args) => {
      calls.push({ tool, args })
      return textResult({
        number: 112, title: 'fix: x', body: '<!-- template\nnote -->## Summary\r\n\r\nText <!-- inline --> more\r\n<details>keep</details>', state: 'open',
        mergeable_state: 'clean', user: { login: 'cblecker' },
        head: { ref: 'fix/x', sha: '70ffdb8c85dc32d63a84662a11d1ed416d2e6b00' }, base: { ref: 'main', sha: '45eee1d', repo: { full_name: 'cblecker/claude-plugins' } },
      })
    },
  })
  const pr = await fetchPr(io, { owner: 'cblecker', repo: 'claude-plugins', number: 112 })
  expect(pr).toEqual({
    owner: 'cblecker', repo: 'claude-plugins', number: 112, title: 'fix: x', body: '## Summary\r\n\r\nText  more\r\n<details>keep</details>',
    author: 'cblecker', state: 'open', baseRef: 'main', headSha: '70ffdb8c85dc32d63a84662a11d1ed416d2e6b00', mergeableState: 'clean',
    baseRepo: 'cblecker/claude-plugins',
  })
  expect(calls[0]!.tool).toBe('pull_request_read')
  expect(calls[0]!.args).toEqual({ method: 'get', owner: 'cblecker', repo: 'claude-plugins', pullNumber: 112 })
})

test('fetchPr leaves baseRepo unset when the response does not name the base repository', async () => {
  const io = ioWith({ mcp: async () => textResult({ title: 't', state: 'open', base: { ref: 'main' }, head: { sha: 'abc' } }) })
  const pr = await fetchPr(io, ref)
  expect(pr.baseRepo).toBe(undefined)
  expect(pr.baseRef).toBe('main')
})

test('fetchPr throws on a tool error and on an empty result', async () => {
  const err = ioWith({ mcp: async () => ({ isError: true, content: [{ type: 'text', text: 'Not Found' }] }) })
  await expect(fetchPr(err, ref)).rejects.toThrow('Not Found')
  const empty = ioWith({ mcp: async () => textResult('null') })
  await expect(fetchPr(empty, ref)).rejects.toThrow('no pull request')
})

// ---- resolvePr ----

const env = (over: Partial<{ head: string; branch: string; origin: string; mergeConfig: string }> = {}) => ({
  head: 'abc123', branch: 'feat/x', origin: 'git@github.com:o/r.git', mergeConfig: '', ...over,
})

test('resolvePr takes the PR number from a gh-pr-checkout merge ref without calling GitHub', async () => {
  const out = await resolvePr(ioWith({}), env({ branch: 'pr-50', mergeConfig: 'branch.pr-50.merge refs/pull/50/head\n' }))
  expect(out).toEqual({ owner: 'o', repo: 'r', number: 50 })
})

test('resolvePr refuses a non-github origin without calling GitHub', async () => {
  const out = await resolvePr(ioWith({}), env({ origin: 'https://gitlab.com/o/r.git' }))
  expect(out).toEqual({ error: 'origin https://gitlab.com/o/r.git is not a github.com repository' })
})

test('resolvePr takes the head filter\'s single PR as the candidate whatever its head sha', async () => {
  const calls: McpCall[] = []
  const io = ioWith({
    mcp: async (tool, args) => {
      calls.push({ tool, args })
      return textResult([{ number: 4, head: { sha: 'stale-local-checkout' } }])
    },
  })
  expect(await resolvePr(io, env())).toEqual({ owner: 'o', repo: 'r', number: 4 })
  expect(calls.length).toBe(1)
  expect(calls[0]!.tool).toBe('list_pull_requests')
  expect(calls[0]!.args).toEqual({ owner: 'o', repo: 'r', state: 'open', head: 'o:feat/x', fields: ['number', 'head'], perPage: 10 })
})

test('resolvePr reports several head-filter PRs without scanning', async () => {
  const calls: McpCall[] = []
  const io = ioWith({
    mcp: async (tool, args) => { calls.push({ tool, args }); return textResult([{ number: 4, head: { sha: 'a' } }, { number: 5, head: { sha: 'b' } }]) },
  })
  expect(await resolvePr(io, env())).toEqual({ error: 'Several open PRs in o/r have head abc123. Check out the PR head, push local commits, or pick one PR.' })
  expect(calls.length).toBe(1)
})

test('resolvePr scans open PRs by head sha when the head filter finds nothing', async () => {
  const calls: McpCall[] = []
  const filler = (from: number) => Array.from({ length: 100 }, (_, i) => ({ number: from + i, head: { sha: `s${from + i}` } }))
  const io = ioWith({
    mcp: async (_tool, args) => {
      calls.push({ tool: 'list_pull_requests', args })
      if (args.head) return textResult([])
      return textResult(args.page === 1 ? filler(1000) : [{ number: 7, head: { sha: 'abc123' } }])
    },
  })
  expect(await resolvePr(io, env())).toEqual({ owner: 'o', repo: 'r', number: 7 })
  expect(calls[1]!.args).toEqual({ owner: 'o', repo: 'r', state: 'open', fields: ['number', 'head'], perPage: 100, page: 1 })
  expect(calls[2]!.args.page).toBe(2)
  expect(calls.length).toBe(3)
})

test('resolvePr scans every page, so a duplicate head sha on a later page is several', async () => {
  const calls: McpCall[] = []
  const page1 = Array.from({ length: 100 }, (_, i) => ({ number: 1000 + i, head: { sha: i === 0 ? 'abc123' : `s${i}` } }))
  const io = ioWith({
    mcp: async (_tool, args) => {
      calls.push({ tool: 'list_pull_requests', args })
      if (args.head) return textResult([])
      return textResult(args.page === 1 ? page1 : [{ number: 7, head: { sha: 'abc123' } }])
    },
  })
  expect(await resolvePr(io, env())).toEqual({ error: 'Several open PRs in o/r have head abc123. Check out the PR head, push local commits, or pick one PR.' })
  expect(calls.length).toBe(3)
})

test('resolvePr keeps scanning past a match and returns it when no later page repeats it', async () => {
  const calls: McpCall[] = []
  const page1 = Array.from({ length: 100 }, (_, i) => ({ number: 1000 + i, head: { sha: i === 3 ? 'abc123' : `s${i}` } }))
  const io = ioWith({
    mcp: async (_tool, args) => {
      calls.push({ tool: 'list_pull_requests', args })
      if (args.head) return textResult([])
      return textResult(args.page === 1 ? page1 : [{ number: 8, head: { sha: 'other' } }])
    },
  })
  expect(await resolvePr(io, env())).toEqual({ owner: 'o', repo: 'r', number: 1003 })
  expect(calls.map((c) => c.args.page)).toEqual([undefined, 1, 2])
})

test('resolvePr says the scan covered only the first 2000 open PRs when the cap hits with no match', async () => {
  const calls: McpCall[] = []
  const full = Array.from({ length: 100 }, (_, i) => ({ number: 1000 + i, head: { sha: `s${i}` } }))
  const io = ioWith({
    mcp: async (_tool, args) => { calls.push({ tool: 'list_pull_requests', args }); return textResult(args.head ? [] : full) },
  })
  const out = await resolvePr(io, env())
  expect(calls.length).toBe(21)
  expect(calls[20]!.args.page).toBe(20)
  expect('error' in out && out.error).toContain('first 2000 open PRs in o/r')
  expect('error' in out && out.error).toContain('abc123')
})

test('resolvePr still finds a match on the last scanned page', async () => {
  const io = ioWith({
    mcp: async (_tool, args) => {
      if (args.head) return textResult([])
      const page = Number(args.page)
      return textResult(Array.from({ length: 100 }, (_, i) => ({ number: page * 1000 + i, head: { sha: page === 20 && i === 0 ? 'abc123' : `s${page}-${i}` } })))
    },
  })
  expect(await resolvePr(io, env())).toEqual({ owner: 'o', repo: 'r', number: 20000 })
})

test('resolvePr skips the head filter on a detached HEAD', async () => {
  const calls: McpCall[] = []
  const io = ioWith({ mcp: async (tool, args) => { calls.push({ tool, args }); return textResult([{ number: 9, head: { sha: 'abc123' } }]) } })
  expect(await resolvePr(io, env({ branch: 'HEAD' }))).toEqual({ owner: 'o', repo: 'r', number: 9 })
  expect(calls.length).toBe(1)
  expect(calls[0]!.args.head).toBeUndefined()
})

test('resolvePr names the head and repository when no PR or several PRs match', async () => {
  const none = ioWith({ mcp: async () => textResult([]) })
  const noneOut = await resolvePr(none, env())
  expect(noneOut).toEqual({ error: 'No open PRs in o/r have head abc123. Check out the PR head, push local commits, or pick one PR.' })

  const many = ioWith({ mcp: async () => textResult([{ number: 1, head: { sha: 'abc123' } }, { number: 2, head: { sha: 'abc123' } }]) })
  const manyOut = await resolvePr(many, env())
  expect(manyOut).toEqual({ error: 'Several open PRs in o/r have head abc123. Check out the PR head, push local commits, or pick one PR.' })
})

test('resolvePr returns an error when listing pull requests fails', async () => {
  const io = ioWith({ mcp: async () => ({ isError: true, content: [{ type: 'text', text: 'bad credentials' }] }) })
  const out = await resolvePr(io, env())
  expect('error' in out && out.error).toContain('bad credentials')
})

// ---- git ----

test('git runs git with the timeout and optional cwd, returns stdout, and quotes stderr on failure', async () => {
  const calls: RunCall[] = []
  const io = ioWith({
    run: async (argv, opts) => {
      calls.push({ argv, opts })
      return argv[1] === 'status' ? ok(' M a.go\n') : fail('fatal: not a git repository\n', 128)
    },
  })
  expect(await git(io, ['status', '--porcelain'], '/repo')).toBe(' M a.go\n')
  expect(calls[0]).toEqual({ argv: ['git', 'status', '--porcelain'], opts: { cwd: '/repo', timeoutMs: 120000 } })
  await expect(git(io, ['rev-parse', 'HEAD'])).rejects.toThrow('git rev-parse failed: fatal: not a git repository')
  expect(calls[1]!.opts!.cwd).toBeUndefined()
  expect(calls[1]!.opts!.timeoutMs).toBe(120000)
})

test('git names the subcommand, not a leading -c option, in its error', async () => {
  const io = ioWith({ run: async () => fail('boom') })
  await expect(git(io, ['-c', 'core.quotePath=false', 'diff', '--numstat', 'a..b'])).rejects.toThrow('git diff failed: boom')
})

test('readEnvironment gathers the checkout facts and tolerates missing branch config', async () => {
  const io = ioWith({
    run: async (argv) => {
      const key = argv.slice(1).join(' ')
      if (key === 'rev-parse HEAD') return ok('abc123\n')
      if (key === 'rev-parse --show-toplevel') return ok('/work/repo\n')
      if (key === 'rev-parse --abbrev-ref HEAD') return ok('feat/x\n')
      if (key === 'remote get-url origin') return ok('https://user:tok3n@github.com/o/r.git\n')
      if (key.startsWith('config --get-regexp')) return fail('', 1)
      if (key === 'status --porcelain') return ok(' M a.go\n?? b.go\n')
      throw new Error(`unexpected git ${key}`)
    },
  })
  expect(await readEnvironment(io)).toEqual({
    head: 'abc123', root: '/work/repo', branch: 'feat/x', origin: 'https://github.com/o/r.git', mergeConfig: '', dirty: ' M a.go\n?? b.go',
  })
})

test('readEnvironment returns the branch config text when present', async () => {
  const io = ioWith({
    run: async (argv) => argv[1] === 'config' ? ok('branch.pr-50.merge refs/pull/50/head\n') : ok('x\n'),
  })
  expect((await readEnvironment(io)).mergeConfig).toBe('branch.pr-50.merge refs/pull/50/head\n')
})

// ---- pinRange ----

test('pinRange refuses an unexpected base ref before running any git command', async () => {
  let runs = 0
  const io = ioWith({ run: async () => { runs++; return ok('') } })
  for (const bad of ['', 'main;rm -rf x', 'a b', '$(id)', '-x\n', 'main\nother', 'ré']) {
    await expect(pinRange(io, '/repo', bad, 'head')).rejects.toThrow('unexpected characters')
  }
  expect(runs).toBe(0)
})

test('pinRange fetches the base, pins the range, and measures base movement', async () => {
  const calls: RunCall[] = []
  const io = ioWith({
    run: async (argv, opts) => {
      calls.push({ argv, opts })
      const key = argv.slice(1).join(' ')
      if (key === 'fetch origin refs/heads/release/1.2') return ok('')
      if (key === 'merge-base FETCH_HEAD HEAD') return ok('mb111\n')
      if (key === 'rev-list --count HEAD..FETCH_HEAD') return ok('3\n')
      if (key === '-c core.quotePath=false diff --name-status mb111..head1') return ok('M\ta.go\n')
      if (key === '-c core.quotePath=false diff --numstat mb111..head1') return ok('1\t0\ta.go\n')
      if (key === 'diff --shortstat mb111..head1') return ok(' 1 file changed, 1 insertion(+)\n')
      throw new Error(`unexpected git ${key}`)
    },
  })
  expect(await pinRange(io, '/repo', 'release/1.2', 'head1')).toEqual({
    mergeBase: 'mb111', baseAheadCount: 3,
    diff: { nameStatus: 'M\ta.go\n', numstat: '1\t0\ta.go\n', shortstat: ' 1 file changed, 1 insertion(+)\n' },
  })
  expect(calls.length).toBe(6)
  for (const c of calls) expect(c.opts).toEqual({ cwd: '/repo', timeoutMs: 120000 })
})

test('pinRange quotes a fetch failure and hints at a shallow clone when merge-base fails', async () => {
  const fetchFails = ioWith({ run: async () => fail('fatal: unable to access origin') })
  await expect(pinRange(fetchFails, '/repo', 'main', 'h')).rejects.toThrow('fatal: unable to access origin')

  const noBase = ioWith({ run: async (argv) => argv[1] === 'merge-base' ? fail('') : ok('') })
  await expect(pinRange(noBase, '/repo', 'main', 'h')).rejects.toThrow('git fetch --unshallow origin')
})
