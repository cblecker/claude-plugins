import { expect, test } from 'claude-code/testing'
import { fallbackSelection, parseSelection, selectLenses } from '../hooks/lib/select'
import type { CompleteRequest, CompleteResult, Io } from '../hooks/lib/io'

const diff = { nameStatus: 'M\ta.go', numstat: '1\t1\ta.go', shortstat: ' 1 file changed' }

// An Io whose only live method is `complete`; the others must not be reached.
function ioWith(complete: (req: CompleteRequest) => Promise<CompleteResult>): Io {
  return {
    run: async () => { throw new Error('run is not part of lens selection') },
    mcp: async () => { throw new Error('mcp is not part of lens selection') },
    complete,
  }
}

test('parseSelection keeps known lenses, dedupes, forces code-reviewer first', () => {
  const s = parseSelection('```json\n{"lenses":[{"name":"pr-test-analyzer","rationale":"r"},{"name":"bogus","rationale":"x"},{"name":"pr-test-analyzer","rationale":"r"}],"shape":{"fileCount":2,"additions":5,"deletions":1,"notableAreas":["a"]}}\n```')!
  expect(s.lenses.map((l) => l.name)).toEqual(['code-reviewer', 'pr-test-analyzer'])
  expect(s.shape!.fileCount).toBe(2)
})

test('parseSelection fills efforts from the roster and moves a listed code-reviewer to the front', () => {
  const s = parseSelection('{"lenses":[{"name":"comment-analyzer","rationale":"docs"},{"name":"code-reviewer","rationale":"always"}]}')!
  expect(s.lenses.map((l) => [l.name, l.effort, l.rationale])).toEqual([
    ['code-reviewer', 'high', 'always'],
    ['comment-analyzer', 'medium', 'docs'],
  ])
  expect(s.shape).toBeNull()
})

test('parseSelection rejects output that is not an object with a non-empty lenses array', () => {
  expect(parseSelection('[1,2]')).toBeNull()
  expect(parseSelection('42')).toBeNull()
  expect(parseSelection('true')).toBeNull()
  expect(parseSelection('null')).toBeNull()
  expect(parseSelection('{"lenses":[]}')).toBeNull()
  expect(parseSelection('{"lenses":"all"}')).toBeNull()
  expect(parseSelection('{"lenses":[{"name":"bogus"}]}')).toBeNull()
  expect(parseSelection('not json')).toBeNull()
})

test('fallbackSelection runs every roster lens with no shape', () => {
  const f = fallbackSelection()
  expect(f.lenses.length).toBe(8)
  expect(f.lenses[0]!.name).toBe('code-reviewer')
  expect(f.shape).toBeNull()
})

test('invalid model output falls back to every lens', async () => {
  const io = ioWith(async () => ({ isAnswered: true, text: 'not json' }))
  const out = await selectLenses(io, diff)
  expect(out.source).toBe('all-lenses-fallback')
  expect(out.lenses.length).toBe(8)
  expect(out.shape).toBeNull()
})

test('a model call that throws falls back to every lens', async () => {
  const io = ioWith(async () => { throw new Error('boom') })
  const out = await selectLenses(io, diff)
  expect(out.source).toBe('all-lenses-fallback')
  expect(out.lenses.length).toBe(8)
})

test('an unanswered model call falls back to every lens', async () => {
  const io = ioWith(async () => ({ isAnswered: false, text: '' }))
  const out = await selectLenses(io, diff)
  expect(out.source).toBe('all-lenses-fallback')
  expect(out.lenses.length).toBe(8)
})

test('a valid answer selects lenses and reports the shape', async () => {
  const io = ioWith(async () => ({
    isAnswered: true,
    text: '{"lenses":[{"name":"concurrency-reviewer","rationale":"adds a mutex"}],"shape":{"fileCount":1,"additions":3,"deletions":0,"notableAreas":["a.go"]}}',
  }))
  const out = await selectLenses(io, diff)
  expect(out.source).toBe('selector')
  expect(out.lenses.map((l) => l.name)).toEqual(['code-reviewer', 'concurrency-reviewer'])
  expect(out.shape).toEqual({ fileCount: 1, additions: 3, deletions: 0, notableAreas: ['a.go'] })
})

test('the request names the model, bounds, and the diff file list', async () => {
  let seen: CompleteRequest | undefined
  const io = ioWith(async (req) => { seen = req; return { isAnswered: true, text: '{"lenses":[{"name":"code-reviewer","rationale":"r"}]}' } })
  await selectLenses(io, diff)
  expect(seen!.model).toBe('sonnet')
  expect(seen!.maxTokens).toBe(4000)
  expect(seen!.effort).toBe('medium')
  expect(seen!.timeoutMs).toBe(180000)
  expect(seen!.prompt).toContain('M\ta.go')
  expect(seen!.prompt).toContain('1 file changed')
  expect(seen!.prompt).toContain('security-reviewer')
})
