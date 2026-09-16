import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkout } from '../lib/checkout.mjs';
import { prepare } from '../lib/prepare.mjs';
import { git } from '../lib/common.mjs';
import { fixture, snapshot } from './helpers.mjs';

function destination(t) {
  const f = fixture(t);
  // Match Codex's starting point: source HEAD differs from the pinned PR head.
  git(f.source, 'update-ref', 'HEAD', f.base);
  const context = prepare('https://github.com/upstream/repo/pull/1', f.options);
  const cwd = join(f.root, 'native checkout');
  git(f.source, 'worktree', 'add', '--detach', cwd, context.sourceHead);
  return { ...f, cwd, context };
}

test('selects pinned PR head, preserves source, and verifies on repeat and resume', t => {
  const { source, cwd, context, head, base } = destination(t);
  const before = snapshot(source);
  const result = checkout(context, { cwd });
  assert.deepEqual(result, { checkoutPath: cwd, headSha: head, baseSha: base, mergeBase: base });
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), head);
  assert.equal(git(cwd, 'branch', '--show-current'), '');
  assert.equal(git(cwd, 'status', '--porcelain'), '');
  // Only the destination's HEAD in the worktree registration may change.
  assert.deepEqual(snapshot(source), { ...before, worktrees: git(source, 'worktree', 'list', '--porcelain', '-z') });
  const prepared = snapshot(cwd);
  assert.deepEqual(checkout(context, { cwd }), result);
  assert.deepEqual(checkout(context, { cwd, verifyOnly: true }), result);
  assert.deepEqual(snapshot(cwd), prepared);
});

for (const refusal of ['source', 'main', 'unrelated', 'branch', 'tracked', 'staged', 'untracked',
  'unexpected-head', 'missing-head', 'missing-base', 'missing-source', 'merge-base', 'resume-source', 'version', 'identity']) {
  test(`refuses ${refusal} and preserves existing work`, t => {
    const { source, root, context, base, head, cwd: initial } = destination(t);
    let cwd = initial;
    if (refusal === 'source') cwd = source;
    if (refusal === 'main') {
      context.sourceCheckout = initial;
      cwd = source;
    }
    if (refusal === 'unrelated') {
      const other = join(root, 'other');
      git(root, 'clone', source, other);
      cwd = join(root, 'other-linked');
      git(other, 'worktree', 'add', '--detach', cwd, 'HEAD');
    }
    if (refusal === 'branch') git(cwd, 'switch', '-c', 'named');
    if (refusal === 'tracked' || refusal === 'staged') {
      writeFileSync(join(cwd, 'file.txt'), 'preserve tracked edits');
      if (refusal === 'staged') git(cwd, 'add', 'file.txt');
    }
    if (refusal === 'untracked') writeFileSync(join(cwd, 'new.txt'), 'preserve untracked work');
    if (refusal === 'unexpected-head') {
      const third = git(source, 'commit-tree', `${base}^{tree}`, '-p', base, '-m', 'unexpected');
      git(cwd, 'switch', '--detach', third);
    }
    if (refusal.startsWith('missing-')) {
      const key = refusal.slice(8);
      if (key === 'head') context.pr.headSha = 'f'.repeat(40);
      else context[key === 'base' ? 'baseSha' : 'sourceHead'] = 'f'.repeat(40);
    }
    if (refusal === 'merge-base') context.mergeBase = head;
    if (refusal === 'version') context.version = 1;
    if (refusal === 'identity') context.pr.number = 2;
    const before = snapshot(cwd), sourceBefore = snapshot(source);
    assert.throws(() => checkout(context, { cwd, verifyOnly: refusal === 'resume-source' }),
      error => error.message.includes(cwd) && /stopped/.test(error.message));
    assert.deepEqual(snapshot(cwd), before);
    assert.deepEqual(snapshot(source), sourceBefore);
  });
}

test('refuses a source worktree even through a symlink', t => {
  const { context, cwd, root } = destination(t);
  context.sourceCheckout = cwd;
  const alias = join(root, 'alias');
  symlinkSync(cwd, alias);
  const before = snapshot(cwd);
  assert.throws(() => checkout(context, { cwd: alias }), /distinct/);
  assert.deepEqual(snapshot(cwd), before);
});

test('non-forced switch preserves an ignored file that conflicts with PR content', t => {
  const { context, cwd, source, base } = destination(t);
  // The PR adds new.txt; the destination already has an ignored copy.
  const build = join(source, '../build');
  git(source, 'worktree', 'add', '--detach', build, base);
  writeFileSync(join(build, 'new.txt'), 'PR content');
  git(build, 'add', 'new.txt');
  context.pr.headSha = git(build, 'commit-tree', git(build, 'write-tree'), '-p', base, '-m', 'add file');
  writeFileSync(join(source, '.git/info/exclude'), 'new.txt\n');
  writeFileSync(join(cwd, 'new.txt'), 'keep ignored content');
  const before = snapshot(cwd);
  assert.throws(() => checkout(context, { cwd }), /switch/);
  assert.deepEqual(snapshot(cwd), before);
  assert.equal(readFileSync(join(cwd, 'new.txt'), 'utf8'), 'keep ignored content');
});

test('CLI consumes JSON on stdin and reports failures with checkout path', t => {
  const { context, cwd } = destination(t);
  const helper = fileURLToPath(new URL('../bin/checkout.mjs', import.meta.url));
  for (const args of [[], ['--verify']]) {
    const result = spawnSync(process.execPath, [helper, ...args], { cwd, input: JSON.stringify(context), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).headSha, context.pr.headSha);
  }
  const result = spawnSync(process.execPath, [helper], { cwd, input: '{invalid', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(cwd));
});
