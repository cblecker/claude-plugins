import { expect, test } from 'claude-code/testing'
import { isReadOnlyCommand as ok, shouldAutoAllow } from '../hooks/lib/bash-guard'

test('allows read-only git, alone or chained, and head/tail', () => {
  expect(ok('git rev-parse HEAD')).toBe(true)
  expect(ok('git -c core.quotePath=false diff --name-status a..b && git log --oneline -3')).toBe(true)
  expect(ok("git --literal-pathspecs diff --no-ext-diff a b -- 'x.go' | head -40")).toBe(true)
  expect(ok('git show bacd8ec --stat | tail -n 20; git blame -L 1,9 f.ts')).toBe(true)
})

test('allows the usual revision, format and quoting syntax', () => {
  expect(ok("git log --oneline HEAD~3..'HEAD^' -- pr-review-toolkit/")).toBe(true)
  expect(ok("git log --format='%h %s' --grep='a; b' -n 5")).toBe(true)
  expect(ok('git diff --stat main...feat/x | head -n 30')).toBe(true)
  expect(ok('git diff a b | head -n30 && git show HEAD:README.md | tail -5')).toBe(true)
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

test('revision ranges stay allowed next to the path checks', () => {
  expect(ok('git diff a..b')).toBe(true)
  expect(ok('git log a...b')).toBe(true)
  expect(ok('git diff HEAD~3..HEAD')).toBe(true)
  expect(ok('git log main..feat/x -- src/a..b.go')).toBe(true)
  expect(ok('git log ..origin/main')).toBe(true)
  expect(ok("git log -L1,9:src/f.go --format='%h %s'")).toBe(true)
})

test('refuses reads outside the checkout', () => {
  expect(ok('git diff --no-index /dev/null /etc/hosts')).toBe(false)
  expect(ok('git diff /dev/null /etc/hosts')).toBe(false)
  expect(ok('git diff ~/.aws/credentials /dev/null')).toBe(false)
  expect(ok('git diff ../../../etc/hosts /dev/null')).toBe(false)
  expect(ok('git blame --contents=/etc/hosts README.md')).toBe(false)
  expect(ok('git diff -O/etc/hosts')).toBe(false)
  expect(ok('git blame --contents README.md')).toBe(false)
  expect(ok('git blame --cont=README.md f')).toBe(false)
  expect(ok('git diff --no-ind a b')).toBe(false)
  expect(ok('git diff --orderfile=order.txt')).toBe(false)
  expect(ok('git diff -O order.txt')).toBe(false)
  expect(ok('git diff -pOorder.txt')).toBe(false)
  expect(ok('git blame --ignore-revs-file=.git-blame-ignore-revs f')).toBe(false)
  expect(ok('git blame --ignore-revs-file .git-blame-ignore-revs f')).toBe(false)
  expect(ok('git blame -S/etc/hosts f')).toBe(false)
  expect(ok('git blame -S revs.txt f')).toBe(false)
  expect(ok('git blame -wSl f')).toBe(false)
  expect(ok('git blame -wS l f')).toBe(false)
  expect(ok('git blame -fS revs f')).toBe(false)
  expect(ok('git blame -w -L 1,9 f')).toBe(true)
  expect(ok('git log -S foo')).toBe(true)
  expect(ok('git log --format=/etc/hosts')).toBe(false)
  expect(ok('git diff a/../../b')).toBe(false)
  expect(ok('git diff ..')).toBe(false)
  expect(ok('git diff -S../x')).toBe(false)
  expect(ok('git diff =git /dev/null')).toBe(false)
  expect(ok("git diff '/etc/hosts' /dev/null")).toBe(false)
})

test('refuses ^ unquoted (a zsh glob) and still takes it quoted', () => {
  expect(ok('git diff --o^x')).toBe(false)
  expect(ok('git diff ^x')).toBe(false)
  expect(ok('git log HEAD^')).toBe(false)
  expect(ok("git log 'HEAD^'")).toBe(true)
})

test('refuses options that run another program or open a viewer', () => {
  expect(ok('git log --show-signature')).toBe(false)
  expect(ok('git log --show-sig')).toBe(false)
  expect(ok("git log --format='%G? %h'")).toBe(false)
  expect(ok('git log --help')).toBe(false)
  expect(ok('git log -h')).toBe(false)
  expect(ok('git diff --help | head -5')).toBe(false)
})

test('head and tail take only a dashed line count', () => {
  expect(ok('git log | head -40')).toBe(true)
  expect(ok('git log | tail -n 20')).toBe(true)
  expect(ok('git log | tail -n20')).toBe(true)
  expect(ok('git log | head -n -5')).toBe(true)
  expect(ok('git log | tail 5')).toBe(false)
  expect(ok('git log | head 40')).toBe(false)
  expect(ok('git log | tail -n 5 6')).toBe(false)
})

const readOnly = { command: 'git log --oneline -3' }
const ask = { decision: 'ask' as const, reason: 'needs approval' }

test('shouldAutoAllow upgrades a plain ask for read-only git', () => {
  expect(shouldAutoAllow(readOnly, ask).decision).toBe('allow')
  expect(shouldAutoAllow({ ...readOnly, description: 'log', timeout: 5000, run_in_background: false }, ask).decision).toBe('allow')
})

test('shouldAutoAllow leaves every other verdict to Claude Code', () => {
  const deny = { decision: 'deny' as const, reason: 'no', rule: 'Bash(git log:*)' }
  const allow = { decision: 'allow' as const, reason: 'rule', rule: 'Bash(git:*)' }
  const ruleAsk = { decision: 'ask' as const, reason: 'asked for', rule: 'Bash(git log:*)' }
  expect(shouldAutoAllow(readOnly, deny)).toBe(deny)
  expect(shouldAutoAllow(readOnly, allow)).toBe(allow)
  expect(shouldAutoAllow(readOnly, ruleAsk)).toBe(ruleAsk)
  expect(shouldAutoAllow({ ...readOnly, dangerouslyDisableSandbox: true }, ask)).toBe(ask)
  expect(shouldAutoAllow({ ...readOnly, dangerouslyDisableSandbox: false }, ask)).toBe(ask)
  expect(shouldAutoAllow({ ...readOnly, allowed_domains: ['example.com'] }, ask)).toBe(ask)
  expect(shouldAutoAllow({ command: 'rm -rf x' }, ask)).toBe(ask)
  expect(shouldAutoAllow({ command: 'git log & rm -rf x' }, ask)).toBe(ask)
})

test('shouldAutoAllow refuses input that is not a plain object with a string command', () => {
  for (const input of [undefined, null, 'git log', 7, ['git log'], {}, { command: 5 }, { command: ['git', 'log'] }]) {
    expect(shouldAutoAllow(input, ask)).toBe(ask)
  }
})
