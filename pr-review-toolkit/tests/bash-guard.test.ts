import { expect, test } from 'claude-code/testing'
import { isReadOnlyCommand as ok } from '../hooks/lib/bash-guard'

test('allows read-only git, alone or chained, and head/tail', () => {
  expect(ok('git rev-parse HEAD')).toBe(true)
  expect(ok('git -c core.quotePath=false diff --name-status a..b && git log --oneline -3')).toBe(true)
  expect(ok("git --literal-pathspecs diff --no-ext-diff a b -- 'x.go' | head -40")).toBe(true)
  expect(ok('git show bacd8ec --stat | tail -n 20; git blame -L 1,9 f.ts')).toBe(true)
})

test('allows the usual revision, format and quoting syntax', () => {
  expect(ok('git log --oneline HEAD~3..HEAD^ -- pr-review-toolkit/')).toBe(true)
  expect(ok("git log --format='%h %s' --grep='a; b' -n 5")).toBe(true)
  expect(ok('git diff --stat main...feat/x | head -n 30')).toBe(true)
  expect(ok('git diff a b | head -n30 && git show HEAD:README.md | tail 5')).toBe(true)
  expect(ok('git log --oneline --ours')).toBe(true)
})

test('refuses writes, other programs, redirection, substitution', () => {
  expect(ok('git log && rm -rf x')).toBe(false)
  expect(ok('git push origin main')).toBe(false)
  expect(ok('git diff > out.txt')).toBe(false)
  expect(ok('git log $(whoami)')).toBe(false)
  expect(ok('git log `id`')).toBe(false)
  expect(ok('cat README.md')).toBe(false)
  expect(ok('git -c alias.x=!sh x')).toBe(false)
  expect(ok('')).toBe(false)
})

test('refuses git options that write a file (R7)', () => {
  expect(ok('git diff --output=README.md')).toBe(false)
  expect(ok('git log --output README.md')).toBe(false)
  expect(ok('git show --output=x HEAD')).toBe(false)
  expect(ok('git diff a b | head -5 && git log --output=x')).toBe(false)
  expect(ok('git diff --output-indicator-new=+')).toBe(false)
  expect(ok('git diff --outpu=x')).toBe(false)
})

test('refuses a single & (background) and other separators it does not understand', () => {
  expect(ok('git log & rm -rf x')).toBe(false)
  expect(ok('git log & git diff')).toBe(false)
  expect(ok('git log &')).toBe(false)
  expect(ok('git log |& head -5')).toBe(false)
  expect(ok('git log ; ; git diff')).toBe(false)
  expect(ok('git log;')).toBe(false)
  expect(ok('git log\nrm x')).toBe(false)
  expect(ok('git log\r\nrm x')).toBe(false)
  expect(ok('(git log)')).toBe(false)
  expect(ok('git log # && rm x')).toBe(false)
})

test('refuses anything the shell would rewrite before git sees it', () => {
  expect(ok('git diff --out""put=README.md')).toBe(false)
  expect(ok("git diff --out''put=README.md")).toBe(false)
  expect(ok("git diff $'--output'=README.md")).toBe(false)
  expect(ok('git diff --out\\put=README.md')).toBe(false)
  expect(ok('git diff $O')).toBe(false)
  expect(ok('git diff "$O"')).toBe(false)
  expect(ok('git diff "$(id)"')).toBe(false)
  expect(ok('git diff "`id`"')).toBe(false)
  expect(ok('git diff *')).toBe(false)
  expect(ok('git diff -- ?.go')).toBe(false)
  expect(ok('git diff {--output=x,y}')).toBe(false)
  expect(ok('git log "unterminated')).toBe(false)
  expect(ok("git log 'unterminated")).toBe(false)
})

test('refuses git forms and programs outside the read-only set', () => {
  expect(ok('git -c core.fsmonitor=x status')).toBe(false)
  expect(ok('git --git-dir=/x log')).toBe(false)
  expect(ok('git -C /x log')).toBe(false)
  expect(ok('git')).toBe(false)
  expect(ok('git commit -m x')).toBe(false)
  expect(ok('GIT_EXTERNAL_DIFF=x git diff')).toBe(false)
  expect(ok('git log | cat')).toBe(false)
  expect(ok('git log | head')).toBe(false)
  expect(ok('git log | head -n')).toBe(false)
  expect(ok('git log | head -f x')).toBe(false)
  expect(ok('head -n 5 file')).toBe(false)
  expect(ok('git log && ls')).toBe(false)
})
