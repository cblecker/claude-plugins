import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const mode of ['success', 'failure', 'incomplete']) test(`shell launcher: ${mode}`, t => {
  const dir = mkdtempSync(join(tmpdir(), 'review shell '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preparation = mode === 'failure' ? 'exit 1' : mode === 'incomplete'
    ? 'printf "%s\\0" "$TEST_CHECKOUT"' : 'printf "%s\\0%s\\0" "$TEST_CHECKOUT" "$TEST_CONTEXT"';
  writeFileSync(join(dir, 'node'), '#!/bin/bash\n' + preparation + '\n', { mode: 0o700 });
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, LAUNCH_CAPTURE: join(dir, 'launch'),
    TEST_CHECKOUT: join(dir, 'checkout with spaces'), TEST_CONTEXT: join(dir, 'context $(literal).json'),
    LAUNCH_SOURCE: fileURLToPath(new URL('../bin/codex-review-pr.bash', import.meta.url)) };
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', `
shopt -s expand_aliases
fake_codex() { printf '%s\\0' "$@" > "$LAUNCH_CAPTURE"; return 7; }
alias codex='fake_codex'
source "$LAUNCH_SOURCE"
codex-review-pr https://github.com/upstream/repo/pull/1
`], { env, encoding: 'utf8' });
  if (mode !== 'success') {
    assert.equal(result.status, 1);
    assert.ok(!existsSync(env.LAUNCH_CAPTURE));
    return;
  }
  assert.equal(result.status, 7, 'preserves Codex exit status');
  const args = readFileSync(env.LAUNCH_CAPTURE, 'utf8').split('\0');
  assert.deepEqual(args.slice(0, 2), ['--cd', env.TEST_CHECKOUT]);
  assert.ok(args[2].includes('$review-pr'));
  assert.ok(args[2].includes(env.TEST_CONTEXT));
  assert.ok(!args.includes('--profile'));
});
