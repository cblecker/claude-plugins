import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const mode of ['success', 'plain-gh', 'auth-failure', 'failure', 'incomplete']) test(`shell launcher: ${mode}`, t => {
  const dir = mkdtempSync(join(tmpdir(), 'review shell '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preparation = mode === 'failure' ? 'exit 1' : mode === 'incomplete'
    ? 'printf "%s\\0" "$TEST_CHECKOUT"' : 'printf "%s\\0%s\\0" "$TEST_CHECKOUT" "$TEST_CONTEXT"';
  const authenticated = 'printf "%s" "fixture-resolved-token"';
  writeFileSync(join(dir, 'gh'), '#!/bin/bash\n' + (mode === 'plain-gh' ? authenticated : 'exit 1') + '\n', { mode: 0o700 });
  writeFileSync(join(dir, 'node'), '#!/bin/bash\nprintf "%s" "$GH_TOKEN" > "$AUTH_CAPTURE"\n' + preparation + '\n', { mode: 0o700 });
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, LAUNCH_CAPTURE: join(dir, 'launch'),
    GH_TOKEN: 'fixture-original-token', GITHUB_TOKEN: '', GITHUB_PERSONAL_ACCESS_TOKEN: '',
    AUTH_CAPTURE: join(dir, 'preparation-auth'), CODEX_AUTH_CAPTURE: join(dir, 'codex-auth'),
    TEST_CHECKOUT: join(dir, 'checkout with spaces'), TEST_CONTEXT: join(dir, 'context $(literal).json'),
    LAUNCH_SOURCE: fileURLToPath(new URL('../bin/codex-review-pr.bash', import.meta.url)) };
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', `
shopt -s expand_aliases
fake_authenticated_gh() {
  [[ "$*" == 'auth token --hostname github.com' ]] || return 2
  ${mode === 'auth-failure' ? 'return 1' : authenticated}
}
${mode === 'plain-gh' ? '' : "alias gh='fake_authenticated_gh'"}
fake_codex() {
  printf '%s' "$GH_TOKEN" > "$CODEX_AUTH_CAPTURE"
  printf '%s\\0' "$@" > "$LAUNCH_CAPTURE"
  return 7
}
alias codex='fake_codex'
source "$LAUNCH_SOURCE"
codex-review-pr https://github.com/upstream/repo/pull/1
`], { env, encoding: 'utf8' });
  assert.ok(!result.stdout.includes('fixture-resolved-token'));
  assert.ok(!result.stderr.includes('fixture-resolved-token'));
  if (mode === 'auth-failure') assert.ok(!existsSync(env.AUTH_CAPTURE));
  else assert.equal(readFileSync(env.AUTH_CAPTURE, 'utf8'), 'fixture-resolved-token');
  if (!['success', 'plain-gh'].includes(mode)) {
    assert.equal(result.status, 1);
    assert.ok(!existsSync(env.LAUNCH_CAPTURE));
    return;
  }
  assert.equal(result.status, 7, 'preserves Codex exit status');
  assert.equal(readFileSync(env.CODEX_AUTH_CAPTURE, 'utf8'), 'fixture-original-token', 'preparation token is scoped to the Node process');
  const args = readFileSync(env.LAUNCH_CAPTURE, 'utf8').split('\0');
  assert.deepEqual(args.slice(0, 2), ['--cd', env.TEST_CHECKOUT]);
  assert.ok(args[2].includes('$review-pr'));
  assert.ok(args[2].includes(env.TEST_CONTEXT));
  assert.ok(!args.includes('--profile'));
});
