import { expect, test } from 'claude-code/testing'
import { LENS_NAMES, lensEffort } from '../hooks/lib/roster'

test('roster pins the workflow REVIEWERS keys', () => {
  expect(LENS_NAMES).toEqual([
    'code-reviewer', 'silent-failure-hunter', 'pr-test-analyzer', 'comment-analyzer',
    'type-design-analyzer', 'security-reviewer', 'api-compat-reviewer', 'concurrency-reviewer',
  ])
})

test('efforts match the workflow (comment-analyzer medium, rest high)', () => {
  expect(lensEffort('comment-analyzer')).toBe('medium')
  expect(lensEffort('code-reviewer')).toBe('high')
})
