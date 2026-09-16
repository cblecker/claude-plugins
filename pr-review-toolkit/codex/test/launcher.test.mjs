import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git } from '../lib/common.mjs';

const modes = ['success', 'nonzero', 'plain-gh', 'auth-failure', 'failure', 'incomplete', 'missing-codex', 'errexit', 'newline-path', 'override-root'];

for (const mode of modes) test(`shell launcher: ${mode}`, { timeout: 15_000 }, t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'review shell $(literal) ')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, mode === 'newline-path' ? 'source\n' : 'source');
  mkdirSync(source);
  git(source, 'init');
  writeFileSync(join(source, 'file.txt'), 'base\n');
  git(source, 'add', 'file.txt');
  // Commit-tree avoids user commit hooks and changes to Git configuration.
  const commit = spawnSync('git', ['commit-tree', git(source, 'write-tree'), '-m', 'launcher fixture'], {
    cwd: source, encoding: 'utf8', env: { ...process.env,
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' }
  });
  assert.equal(commit.status, 0, commit.stderr);
  git(source, 'update-ref', 'HEAD', commit.stdout.trim());
  writeFileSync(join(source, 'file.txt'), 'keep tracked changes');
  writeFileSync(join(source, 'untracked'), 'keep untracked changes');
  const initialStatus = git(source, 'status', '--porcelain');
  const initialWorktrees = git(source, 'worktree', 'list', '--porcelain', '-z');

  const authenticated = 'printf "%s" "fixture-resolved-token"';
  writeFileSync(join(dir, 'gh'), '#!/bin/bash\n' + (mode === 'plain-gh' ? authenticated : 'exit 1') + '\n', { mode: 0o700 });
  // Replace network preparation with an exact inline JSON handoff.
  writeFileSync(join(dir, 'node'), `#!/bin/bash
if [[ "$1" == */bin/prepare.mjs ]]; then
  exec "$REAL_NODE" "$PREPARE_FIXTURE" "$@"
fi
exec "$REAL_NODE" "$@"
`, { mode: 0o700 });
  const prepareFixture = join(dir, 'prepare-fixture.mjs');
  const context = { version: 2, sourceCheckout: source, commonGitDir: join(source, '.git'),
    sourceHead: commit.stdout.trim(), pr: { url: 'https://github.com/upstream/repo/pull/1',
      owner: 'upstream', repo: 'repo', number: 1, headSha: commit.stdout.trim() },
    baseSha: commit.stdout.trim(), mergeBase: commit.stdout.trim() };
  writeFileSync(prepareFixture, `import { writeFileSync } from 'node:fs';
if (process.argv.length !== 4 || process.argv[3] !== 'https://github.com/upstream/repo/pull/1')
  throw Error('Unexpected preparation arguments');
writeFileSync(process.env.AUTH_CAPTURE, process.env.GH_TOKEN);
if (process.env.TEST_MODE === 'failure') process.exit(1);
process.stdout.write(process.env.TEST_MODE === 'incomplete' ? '{}' : JSON.stringify(${JSON.stringify(context)}) + '\\n');
`);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, LAUNCH_CAPTURE: join(dir, 'launch'),
    GH_TOKEN: 'fixture-original-token', GITHUB_TOKEN: '', GITHUB_PERSONAL_ACCESS_TOKEN: '',
    AUTH_CAPTURE: join(dir, 'preparation-auth'), CODEX_AUTH_CAPTURE: join(dir, 'codex-auth'),
    TEST_MODE: mode,
    ...(mode === 'override-root' ? { CODEX_REVIEW_PLUGIN_ROOT: join(dir, 'plugin override') } : {}),
    REAL_NODE: process.execPath, PREPARE_FIXTURE: prepareFixture,
    LAUNCH_SOURCE: fileURLToPath(new URL('../bin/codex-review-pr.bash', import.meta.url)) };
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', `
shopt -s expand_aliases
trap ':' EXIT INT TERM HUP
original_traps=$(trap -p)
fake_authenticated_gh() {
  [[ "$*" == 'auth token --hostname github.com' ]] || return 2
  ${mode === 'auth-failure' ? 'return 1' : authenticated}
}
${mode === 'plain-gh' ? '' : "alias gh='fake_authenticated_gh'"}
fake_codex() {
  printf '%s' "$GH_TOKEN" > "$CODEX_AUTH_CAPTURE"
  printf '%s\\0' "$@" > "$LAUNCH_CAPTURE"
  return ${['nonzero', 'errexit'].includes(mode) ? 7 : 0}
}
alias codex='${mode === 'missing-codex' ? 'missing-codex-fixture-command' : 'fake_codex'}'
source "$LAUNCH_SOURCE"
${mode === 'errexit' ? 'set -e' : ''}
codex-review-pr https://github.com/upstream/repo/pull/1
launch_status=$?
[[ "$(trap -p)" == "$original_traps" ]] || exit 99
exit "$launch_status"
`], { cwd: source, env, encoding: 'utf8', detached: true, timeout: 10_000 });
  assert.equal(result.error, undefined, result.stderr);
  assert.ok(!result.stdout.includes('fixture-resolved-token'));
  assert.ok(!result.stderr.includes('fixture-resolved-token'));
  const expectedStatus = ['auth-failure', 'failure', 'incomplete'].includes(mode) ? 1 : mode === 'missing-codex' ? 127
    : ['nonzero', 'errexit'].includes(mode) ? 7 : 0;
  assert.equal(result.status, expectedStatus, result.stderr);
  assert.equal(git(source, 'status', '--porcelain'), initialStatus);
  if (mode === 'auth-failure') assert.ok(!existsSync(env.AUTH_CAPTURE));
  else assert.equal(readFileSync(env.AUTH_CAPTURE, 'utf8'), 'fixture-resolved-token');
  assert.equal(git(source, 'worktree', 'list', '--porcelain', '-z'), initialWorktrees);
  if (['auth-failure', 'failure', 'incomplete', 'missing-codex'].includes(mode)) {
    assert.ok(!existsSync(env.LAUNCH_CAPTURE));
    return;
  }
  assert.equal(readFileSync(env.CODEX_AUTH_CAPTURE, 'utf8'), 'fixture-original-token', 'preparation token stays scoped');
  const args = readFileSync(env.LAUNCH_CAPTURE, 'utf8').split('\0');
  assert.deepEqual(args.slice(0, 5), ['--enable', 'worktrees', '--worktree', '--cd', source]);
  assert.equal(args.length, 7, 'one prompt argument plus trailing NUL');
  const pluginRoot = env.CODEX_REVIEW_PLUGIN_ROOT || fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
  assert.equal(args[5], `Use $review-pr from ${pluginRoot}/codex/skills/review-pr/SKILL.md with this launcher context JSON: ${JSON.stringify(context)}
Run analysis now, present the board, then discuss it with me.`);
});
