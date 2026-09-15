import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git } from '../lib/common.mjs';

const modes = ['success', 'nonzero', 'plain-gh', 'auth-failure', 'failure', 'incomplete', 'missing-codex', 'dirty', 'errexit'];
for (const stage of ['prepare', 'review']) for (const signal of ['INT', 'TERM', 'HUP']) modes.push(`${stage}-${signal}`);

for (const mode of modes) test(`shell launcher: ${mode}`, { timeout: 15_000 }, t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'review shell $(literal) ')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source'), sessions = join(dir, 'temporary files');
  mkdirSync(source); mkdirSync(sessions);
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
  // Use the real session helper; replace only network preparation with a local
  // worktree fixture, including failures after allocation but before handoff.
  writeFileSync(join(dir, 'node'), `#!/bin/bash
if [[ "$1" == */bin/prepare.mjs ]]; then
  exec "$REAL_NODE" "$PREPARE_FIXTURE" "$@"
fi
exec "$REAL_NODE" "$@"
`, { mode: 0o700 });
  const prepareFixture = join(dir, 'prepare-fixture.mjs');
  writeFileSync(prepareFixture, `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const session = process.argv[4], checkout = join(session, 'checkout'), context = join(session, 'context.json');
writeFileSync(process.env.AUTH_CAPTURE, process.env.GH_TOKEN);
writeFileSync(process.env.SESSION_CAPTURE, session);
execFileSync('git', ['worktree', 'add', '--detach', checkout, 'HEAD']);
writeFileSync(context, '{}');
const mode = process.env.TEST_MODE;
if (mode.startsWith('prepare-')) process.kill(0, 'SIG' + mode.slice(8));
if (mode === 'failure') process.exit(1);
process.stdout.write(checkout + '\\0' + (mode === 'incomplete' ? '' : context + '\\0'));
`);
  const reviewFixture = join(dir, 'review-fixture.mjs');
  writeFileSync(reviewFixture, `import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const mode = process.env.TEST_MODE;
if (mode.startsWith('review-')) process.kill(0, 'SIG' + mode.slice(7));
if (mode === 'dirty') writeFileSync(join(readFileSync(process.env.SESSION_CAPTURE, 'utf8'), 'checkout', 'keep'), 'new work');
process.exit(['nonzero', 'dirty', 'errexit'].includes(mode) ? 7 : 0);
`);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, LAUNCH_CAPTURE: join(dir, 'launch'),
    GH_TOKEN: 'fixture-original-token', GITHUB_TOKEN: '', GITHUB_PERSONAL_ACCESS_TOKEN: '',
    AUTH_CAPTURE: join(dir, 'preparation-auth'), CODEX_AUTH_CAPTURE: join(dir, 'codex-auth'),
    SESSION_CAPTURE: join(dir, 'session'), TEST_MODE: mode, TMPDIR: sessions,
    REAL_NODE: process.execPath, PREPARE_FIXTURE: prepareFixture, REVIEW_FIXTURE: reviewFixture,
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
  "$REAL_NODE" "$REVIEW_FIXTURE"
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
  const expectedStatus = /-(INT|TERM|HUP)$/.test(mode) ? { INT: 130, TERM: 143, HUP: 129 }[mode.split('-')[1]]
    : ['auth-failure', 'failure', 'incomplete'].includes(mode) ? 1 : mode === 'missing-codex' ? 127
      : ['nonzero', 'dirty', 'errexit'].includes(mode) ? 7 : 0;
  assert.equal(result.status, expectedStatus, result.stderr);
  assert.equal(git(source, 'status', '--porcelain'), initialStatus);
  if (mode === 'auth-failure') assert.ok(!existsSync(env.AUTH_CAPTURE));
  else assert.equal(readFileSync(env.AUTH_CAPTURE, 'utf8'), 'fixture-resolved-token');
  if (mode === 'dirty') {
    const session = readFileSync(env.SESSION_CAPTURE, 'utf8');
    assert.ok(result.stderr.includes(join(session, 'checkout')));
    assert.ok(result.stderr.includes('git worktree remove'));
    assert.equal(readFileSync(join(session, 'checkout/keep'), 'utf8'), 'new work');
    assert.ok(!existsSync(join(session, 'context.json')));
    assert.ok(!existsSync(join(session, 'launch-args')));
  } else {
    assert.deepEqual(readdirSync(sessions), []);
    assert.equal(git(source, 'worktree', 'list', '--porcelain', '-z'), initialWorktrees);
  }
  if (['auth-failure', 'failure', 'incomplete', 'missing-codex'].includes(mode) || mode.startsWith('prepare-')) {
    assert.ok(!existsSync(env.LAUNCH_CAPTURE));
    return;
  }
  assert.equal(readFileSync(env.CODEX_AUTH_CAPTURE, 'utf8'), 'fixture-original-token', 'preparation token stays scoped');
  const session = readFileSync(env.SESSION_CAPTURE, 'utf8');
  const args = readFileSync(env.LAUNCH_CAPTURE, 'utf8').split('\0');
  assert.deepEqual(args.slice(0, 2), ['--cd', join(session, 'checkout')]);
  assert.ok(args[2].includes('$review-pr'));
  assert.ok(args[2].includes(join(session, 'context.json')));
  assert.ok(!args.includes('--profile'));
});

test('session allocation honors TMPDIR and creates private, distinct directories', t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'review temp ')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const helper = fileURLToPath(new URL('../bin/session.mjs', import.meta.url));
  const sessions = [1, 2].map(() => {
    const result = spawnSync(process.execPath, [helper, 'create'], { env: { ...process.env, TMPDIR: dir }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const session = result.stdout.trim();
    assert.ok(session.startsWith(join(dir, 'codex-review-')));
    assert.equal(statSync(session).mode & 0o777, 0o700);
    return session;
  });
  assert.notEqual(...sessions);
});
