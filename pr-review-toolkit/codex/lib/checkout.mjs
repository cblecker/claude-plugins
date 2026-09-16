import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { git } from './common.mjs';
import { parsePR } from './prepare.mjs';

// Only the initial preflight may transition from the source HEAD to the PR head.
// Resume uses verifyOnly so a changed checkout cannot silently be retargeted.
export function checkout(context, { cwd = process.cwd(), verifyOnly = false } = {}) {
  let checkoutPath = cwd;
  try {
    checkoutPath = realpathSync(git(cwd, 'rev-parse', '--show-toplevel'));
    if (context?.version !== 2) throw Error('Expected version-2 launcher context');
    for (const path of [context.sourceCheckout, context.commonGitDir])
      if (typeof path !== 'string' || !isAbsolute(path) || realpathSync(path) !== path)
        throw Error('Expected canonical source checkout and common Git directory');
    const identity = parsePR(context.pr?.url);
    for (const key of ['owner', 'repo', 'number'])
      if (identity[key] !== context.pr[key]) throw Error('PR identity does not match its URL');
    const { sourceHead, baseSha, mergeBase, pr: { headSha } } = context;
    for (const sha of [sourceHead, headSha, baseSha, mergeBase]) {
      if (!/^[0-9a-f]{40}$/.test(sha || '')) throw Error('Invalid pinned commit SHA');
    }
    const common = realpathSync(git(checkoutPath, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
    const gitDir = realpathSync(git(checkoutPath, 'rev-parse', '--absolute-git-dir'));
    if (checkoutPath === context.sourceCheckout || gitDir === common)
      throw Error('Expected a linked worktree distinct from the source and main checkout');
    if (common !== context.commonGitDir)
      throw Error('Checkout belongs to an unrelated repository');
    if (git(checkoutPath, 'branch', '--show-current') !== '') throw Error('Expected a detached HEAD');
    const assertClean = () => {
      if (git(checkoutPath, 'status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=none'))
        throw Error('Expected a clean checkout');
    };
    assertClean();
    for (const sha of [sourceHead, headSha, baseSha, mergeBase])
      git(checkoutPath, 'cat-file', '-e', `${sha}^{commit}`);
    if (git(checkoutPath, 'merge-base', baseSha, headSha) !== mergeBase)
      throw Error('Pinned merge-base does not match the review range');
    const currentHead = git(checkoutPath, 'rev-parse', 'HEAD');
    if (currentHead !== headSha && (verifyOnly || currentHead !== sourceHead))
      throw Error('Unexpected checkout HEAD; start a new review');
    if (currentHead !== headSha)
      git(checkoutPath, 'switch', '--detach', '--no-overwrite-ignore', headSha);
    if (git(checkoutPath, 'rev-parse', 'HEAD') !== headSha) throw Error('Checkout HEAD does not match PR head');
    assertClean();
    return { checkoutPath, headSha, baseSha, mergeBase };
  } catch (error) {
    throw Error(`Review checkout preparation stopped at ${checkoutPath}: ${error.message}`, { cause: error });
  }
}
