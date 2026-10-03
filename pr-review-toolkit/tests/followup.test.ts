import { expect, test } from 'claude-code/testing'
import { computeDelta, detectFollowUp, parseDeltaHunks } from '../hooks/lib/followup'
import type { Io, ProcResult } from '../hooks/lib/io'
import type { Review, Thread } from '../hooks/lib/types'

const thread = (over: Partial<Thread> = {}): Thread => ({ id: 't1', path: 'a.go', line: 3, author: 'me', body: 'ask', replies: [], ...over })
const review = (over: Partial<Review> = {}): Review => ({ author: 'me', state: 'COMMENTED', commitId: 'aaaaaaa', submittedAt: '2026-01-01T00:00:00Z', body: '', ...over })

test('no follow-up on the reviewer\'s own PR or without a login', () => {
  expect(detectFollowUp([], [], 'me', 'me')).toBe(null)
  expect(detectFollowUp([], [], '', 'them')).toBe(null)
  // Own-PR threads and reviews are author notes: still no follow-up, whatever the case.
  expect(detectFollowUp([thread()], [review({ state: 'APPROVED' })], 'Me', 'mE')).toBe(null)
})

test('no follow-up when the reviewer has neither threads nor a review', () => {
  expect(detectFollowUp([], [], 'me', 'them')).toBe(null)
  expect(detectFollowUp([thread({ author: 'other' })], [review({ author: 'other', state: 'APPROVED' })], 'me', 'them')).toBe(null)
})

test('uses the latest substantive review as the baseline', () => {
  const reviews: any = [
    { author: 'me', state: 'COMMENTED', commitId: 'aaaaaaa', submittedAt: '2026-01-02T00:00:00Z', body: '' },
    { author: 'me', state: 'CHANGES_REQUESTED', commitId: 'bbbbbbb', submittedAt: '2026-01-01T00:00:00Z', body: 'fix x' },
  ]
  const f = detectFollowUp([], reviews, 'me', 'them')!
  expect(f.reviewedCommit).toBe('bbbbbbb')
  expect(f.reviewSummaries.map((s) => s.state)).toEqual(['CHANGES_REQUESTED'])
})

test('returns the context fields: baseline commit, time, state, own threads and summaries', () => {
  const mine = thread({ id: 'mine' })
  const f = detectFollowUp(
    [mine, thread({ id: 'theirs', author: 'other' })],
    [review({ state: 'CHANGES_REQUESTED', commitId: 'abc1234', submittedAt: '2026-02-03T04:05:06Z', body: '  fix it  ' })],
    'me',
    'them',
  )
  expect(f).toEqual({
    reviewedCommit: 'abc1234',
    reviewedAt: '2026-02-03T04:05:06Z',
    reviewState: 'CHANGES_REQUESTED',
    threads: [mine],
    reviewSummaries: [{ state: 'CHANGES_REQUESTED', submittedAt: '2026-02-03T04:05:06Z', body: 'fix it' }],
  })
})

test('matches a human reviewer by exact login; other accounts and bots never match', () => {
  const f = detectFollowUp(
    [thread({ id: 'a', author: 'me' }), thread({ id: 'b', author: 'me[bot]' }), thread({ id: 'c', author: 'ME' })],
    [review({ author: 'me[bot]', state: 'APPROVED', body: 'bot' }), review({ author: 'ME', state: 'APPROVED', body: 'caps' })],
    'me',
    'them',
  )!
  expect(f.threads.map((t) => t.id)).toEqual(['a'])
  expect(f.reviewSummaries).toEqual([])
  expect(f.reviewedCommit).toBe('')
})

test('pending reviews never count', () => {
  expect(detectFollowUp([], [review({ state: 'PENDING', body: 'draft' })], 'me', 'them')).toBe(null)
})

test('empty COMMENTED reviews from thread replies do not move the baseline', () => {
  const reviews = [
    review({ state: 'APPROVED', commitId: 'bbbbbbb', submittedAt: '2026-01-01T00:00:00Z' }),
    review({ state: 'COMMENTED', commitId: 'ccccccc', submittedAt: '2026-01-03T00:00:00Z', body: '   ' }),
  ]
  const f = detectFollowUp([], reviews, 'me', 'them')!
  expect(f.reviewedCommit).toBe('bbbbbbb')
  expect(f.reviewState).toBe('APPROVED')
  // The bodyless APPROVED stays in as a state marker; the empty reply review does not.
  expect(f.reviewSummaries).toEqual([{ state: 'APPROVED', submittedAt: '2026-01-01T00:00:00Z', body: '' }])
})

test('an inline-only COMMENTED review is the baseline when the reviewer has threads and nothing more substantive exists', () => {
  const reviews = [
    review({ commitId: 'ccccccc', submittedAt: '2026-01-01T00:00:00Z' }),
    review({ commitId: 'ddddddd', submittedAt: '2026-01-02T00:00:00Z' }),
  ]
  expect(detectFollowUp([], reviews, 'me', 'them')).toBe(null)
  const f = detectFollowUp([thread()], reviews, 'me', 'them')!
  expect(f.reviewedCommit).toBe('ddddddd')
  expect(f.reviewState).toBe('COMMENTED')
  expect(f.reviewSummaries).toEqual([])
})

test('threads without any review leave the baseline empty', () => {
  const f = detectFollowUp([thread()], [], 'me', 'them')!
  expect(f.reviewedCommit).toBe('')
  expect(f.reviewedAt).toBe('')
  expect(f.reviewState).toBe('')
  expect(f.threads.length).toBe(1)
})

test('a commitId that is not a hex SHA never becomes the baseline commit', () => {
  for (const commitId of ['--output=x', 'ABCDEF1', 'abc', 'zzzzzzz', undefined, `${'a'.repeat(41)}`]) {
    const f = detectFollowUp([], [review({ state: 'APPROVED', commitId })], 'me', 'them')!
    expect(f.reviewedCommit).toBe('')
    expect(f.reviewState).toBe('APPROVED')
  }
  expect(detectFollowUp([], [review({ state: 'APPROVED', commitId: 'a'.repeat(40) })], 'me', 'them')!.reviewedCommit).toBe('a'.repeat(40))
})

test('review summaries run oldest first and keep bodyless decisions as state markers', () => {
  const reviews = [
    review({ state: 'COMMENTED', submittedAt: '2026-01-03T00:00:00Z', body: 'second look' }),
    review({ state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01T00:00:00Z', body: 'fix x' }),
    review({ state: 'APPROVED', submittedAt: '2026-01-02T00:00:00Z', body: '' }),
    review({ state: 'COMMENTED', submittedAt: '2026-01-04T00:00:00Z', body: '' }),
  ]
  const f = detectFollowUp([], reviews, 'me', 'them')!
  expect(f.reviewSummaries.map((s) => [s.state, s.body])).toEqual([
    ['CHANGES_REQUESTED', 'fix x'],
    ['APPROVED', ''],
    ['COMMENTED', 'second look'],
  ])
  expect(f.reviewState).toBe('COMMENTED')
  expect(f.reviewedAt).toBe('2026-01-03T00:00:00Z')
})

test('parses -U0 hunks into head line ranges', () => {
  const d = 'diff --git a/x.go b/x.go\n--- a/x.go\n+++ b/x.go\n@@ -3,0 +4,2 @@\n+a\n+b\n@@ -9 +11,0 @@\n-c\n'
  expect(parseDeltaHunks(d)).toEqual([{ path: 'x.go', hunks: [[4, 5], [11, 11]] }])
})

test('parses hunks with any amount of context', () => {
  const d = [
    'diff --git a/x.go b/x.go', 'index 1..2 100644', '--- a/x.go', '+++ b/x.go',
    '@@ -1,5 +1,6 @@ func main() {', ' a', ' b', ' c', '+new', ' d', ' e',
    '@@ -20,4 +21,3 @@', ' f', '-gone', ' g', ' h',
    '',
  ].join('\n')
  expect(parseDeltaHunks(d)).toEqual([{ path: 'x.go', hunks: [[1, 6], [21, 23]] }])
})

test('a deleted file makes no entry and its hunks never land on a neighbour', () => {
  const d = [
    'diff --git a/a.go b/a.go', '--- a/a.go', '+++ b/a.go', '@@ -1 +1 @@', '-x', '+y',
    'diff --git a/gone.go b/gone.go', 'deleted file mode 100644', '--- a/gone.go', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-one', '-two',
    'diff --git a/b.go b/b.go', '--- a/b.go', '+++ b/b.go', '@@ -5,0 +6 @@', '+z',
    '',
  ].join('\n')
  expect(parseDeltaHunks(d)).toEqual([
    { path: 'a.go', hunks: [[1, 1]] },
    { path: 'b.go', hunks: [[6, 6]] },
  ])
})

test('a new file gets one hunk under its path', () => {
  const d = 'diff --git a/n.go b/n.go\nnew file mode 100644\n--- /dev/null\n+++ b/n.go\n@@ -0,0 +1,3 @@\n+a\n+b\n+c\n'
  expect(parseDeltaHunks(d)).toEqual([{ path: 'n.go', hunks: [[1, 3]] }])
})

test('hunk body lines that look like headers are content, not a new file', () => {
  const d = [
    'diff --git a/p.patch b/p.patch', '--- a/p.patch', '+++ b/p.patch',
    '@@ -1,2 +1,4 @@', ' ctx', '+++ b/evil.go', '+@@ -9 +99 @@', ' ctx2',
    'diff --git a/q.go b/q.go', '--- a/q.go', '+++ b/q.go', '@@ -7 +7 @@', '-a', '+b',
    '',
  ].join('\n')
  expect(parseDeltaHunks(d)).toEqual([
    { path: 'p.patch', hunks: [[1, 4]] },
    { path: 'q.go', hunks: [[7, 7]] },
  ])
})

test('keeps going past "\\ No newline at end of file" markers', () => {
  const d = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n@@ -9 +9 @@\n-c\n+d\n'
  expect(parseDeltaHunks(d)).toEqual([{ path: 'x', hunks: [[1, 1], [9, 9]] }])
})

test('paths with spaces (git adds a trailing tab) and quoted paths decode to the real path', () => {
  const d = [
    'diff --git a/my file.go b/my file.go', '--- a/my file.go\t', '+++ b/my file.go\t', '@@ -1 +1 @@', '-a', '+b',
    'diff --git "a/t\\tab.go" "b/t\\tab.go"', '--- "a/t\\tab.go"', '+++ "b/t\\tab.go"', '@@ -2 +2 @@', '-a', '+b',
    'diff --git "a/q\\"uo\\\\te.go" "b/q\\"uo\\\\te.go"', '--- "a/q\\"uo\\\\te.go"', '+++ "b/q\\"uo\\\\te.go"', '@@ -3 +3 @@', '-a', '+b',
    'diff --git "a/\\303\\251.go" "b/\\303\\251.go"', '--- "a/\\303\\251.go"', '+++ "b/\\303\\251.go"', '@@ -4 +4 @@', '-a', '+b',
    '',
  ].join('\n')
  expect(parseDeltaHunks(d).map((f) => f.path)).toEqual(['my file.go', 't\tab.go', 'q"uo\\te.go', 'é.go'])
})

test('an empty or unparsable diff has no files', () => {
  expect(parseDeltaHunks('')).toEqual([])
  expect(parseDeltaHunks('Binary files a/x and b/x differ\n')).toEqual([])
})

// An Io whose `run` answers by subcommand and records every call.
type Call = { argv: string[]; opts?: { cwd?: string; timeoutMs?: number } }
function gitIo(answers: { ancestor?: ProcResult; count?: ProcResult; diff?: ProcResult }): { io: Io; calls: Call[] } {
  const ok = (stdout: string): ProcResult => ({ exitCode: 0, stdout, stderr: '' })
  const calls: Call[] = []
  const io: Io = {
    run: async (argv, opts) => {
      calls.push({ argv, opts })
      if (argv.includes('merge-base')) return answers.ancestor ?? ok('')
      if (argv.includes('rev-list')) return answers.count ?? ok('2\n')
      if (argv.includes('diff')) return answers.diff ?? ok('')
      throw new Error(`unexpected command: ${argv.join(' ')}`)
    },
    mcp: async () => { throw new Error('mcp is not part of the delta') },
    complete: async () => { throw new Error('complete is not part of the delta') },
  }
  return { io, calls }
}

const reviewed = 'a'.repeat(40)
const head = 'b'.repeat(40)

test('computeDelta refuses a reviewed commit that is not a hex SHA without running git', async () => {
  for (const bad of ['', 'abc', 'HEAD', '--output=x', 'ABCDEF1', 'g'.repeat(40), 'a'.repeat(41), `${reviewed};rm`]) {
    const { io, calls } = gitIo({})
    expect(await computeDelta(io, '/repo', bad, head)).toEqual({ available: false })
    expect(calls.length).toBe(0)
  }
})

test('computeDelta refuses a head that could be read as an option without running git', async () => {
  const { io, calls } = gitIo({})
  expect(await computeDelta(io, '/repo', reviewed, '--output=x')).toEqual({ available: false })
  expect(await computeDelta(io, '/repo', reviewed, '')).toEqual({ available: false })
  expect(calls.length).toBe(0)
})

test('computeDelta is unavailable when the reviewed commit is not an ancestor of head', async () => {
  const { io, calls } = gitIo({ ancestor: { exitCode: 1, stdout: '', stderr: '' } })
  expect(await computeDelta(io, '/repo', reviewed, head)).toEqual({ available: false })
  // Nothing past the ancestry check runs.
  expect(calls.length).toBe(1)
  expect(calls[0]!.argv).toEqual(['git', 'merge-base', '--is-ancestor', reviewed, head])
  expect(calls[0]!.opts!.cwd).toBe('/repo')
})

test('computeDelta is unavailable when git cannot find the commit at all', async () => {
  const { io } = gitIo({ ancestor: { exitCode: 128, stdout: '', stderr: 'fatal: Not a valid commit name' } })
  expect(await computeDelta(io, '/repo', reviewed, head)).toEqual({ available: false })
})

test('computeDelta reports commitsSince and the changed head line ranges', async () => {
  const diff = 'diff --git a/x.go b/x.go\n--- a/x.go\n+++ b/x.go\n@@ -3,0 +4,2 @@\n+a\n+b\n@@ -9 +11,0 @@\n-c\ndiff --git a/gone b/gone\n--- a/gone\n+++ /dev/null\n@@ -1 +0,0 @@\n-z\n'
  const { io, calls } = gitIo({ count: { exitCode: 0, stdout: '3\n', stderr: '' }, diff: { exitCode: 0, stdout: diff, stderr: '' } })
  expect(await computeDelta(io, '/repo', reviewed, head)).toEqual({
    available: true,
    commitsSince: 3,
    files: [{ path: 'x.go', hunks: [[4, 5], [11, 11]] }],
  })
  const range = `${reviewed}..${head}`
  expect(calls.map((c) => c.opts!.cwd)).toEqual(['/repo', '/repo', '/repo'])
  const count = calls.find((c) => c.argv.includes('rev-list'))!
  expect(count.argv).toEqual(['git', 'rev-list', '--count', range])
  const d = calls.find((c) => c.argv.includes('diff'))!
  // Global options precede the subcommand; the repo's diff config must not change the output shape.
  const sub = d.argv.indexOf('diff')
  expect(d.argv.slice(0, sub)).toContain('--literal-pathspecs')
  expect(d.argv.slice(0, sub).join(' ')).toContain('core.quotePath=false')
  expect(d.argv).toContain('-U0')
  expect(d.argv).toContain('--no-ext-diff')
  expect(d.argv).toContain('--no-textconv')
  expect(d.argv).toContain('--inter-hunk-context=5')
  expect(d.argv).toContain('--src-prefix=a/')
  expect(d.argv).toContain('--dst-prefix=b/')
  expect(d.argv).toContain(range)
  expect(typeof d.opts!.timeoutMs).toBe('number')
})

test('computeDelta treats an unreadable count as zero commits', async () => {
  const { io } = gitIo({ count: { exitCode: 0, stdout: 'nope', stderr: '' } })
  expect(await computeDelta(io, '/repo', reviewed, head)).toEqual({ available: true, commitsSince: 0, files: [] })
})

test('computeDelta is unavailable when rev-list or diff fails', async () => {
  const bad: ProcResult = { exitCode: 128, stdout: '', stderr: 'fatal' }
  expect(await computeDelta(gitIo({ count: bad }).io, '/repo', reviewed, head)).toEqual({ available: false })
  expect(await computeDelta(gitIo({ diff: bad }).io, '/repo', reviewed, head)).toEqual({ available: false })
})

test('computeDelta is unavailable when the host truncated the diff output', async () => {
  const diff = 'diff --git a/x.go b/x.go\n--- a/x.go\n+++ b/x.go\n@@ -3,0 +4,2 @@\n+a\n+b\n'
  const cut: ProcResult = { exitCode: 0, stdout: diff, stderr: '', truncated: true }
  expect(await computeDelta(gitIo({ diff: cut }).io, '/repo', reviewed, head)).toEqual({ available: false })
  // An explicit `truncated: false` is a complete diff.
  const whole: ProcResult = { ...cut, truncated: false }
  expect(await computeDelta(gitIo({ diff: whole }).io, '/repo', reviewed, head)).toEqual({
    available: true,
    commitsSince: 2,
    files: [{ path: 'x.go', hunks: [[4, 5]] }],
  })
})

test('computeDelta is unavailable when git cannot be run', async () => {
  const io: Io = {
    run: async () => { throw new Error('timed out') },
    mcp: async () => { throw new Error('unused') },
    complete: async () => { throw new Error('unused') },
  }
  expect(await computeDelta(io, '/repo', reviewed, head)).toEqual({ available: false })
})
