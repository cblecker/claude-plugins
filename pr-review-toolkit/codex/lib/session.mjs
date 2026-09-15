import { mkdtempSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './common.mjs';

export const createSession = (root = tmpdir()) => realpathSync(mkdtempSync(join(root, 'codex-review-')));

export function cleanupSession(sessionDir, { cwd = process.cwd(), gitCommand = git } = {}) {
  const checkoutPath = join(sessionDir, 'checkout');
  const retained = [];
  try { gitCommand(cwd, 'worktree', 'remove', checkoutPath); }
  catch {
    // Failed adds may leave an empty, unregistered directory. A failed lookup
    // must never turn into permission to discard a registered worktree.
    let registered = true;
    try { registered = gitCommand(cwd, 'worktree', 'list', '--porcelain', '-z').split('\0').includes(`worktree ${checkoutPath}`); }
    catch { /* Retain the checkout when registration cannot be checked. */ }
    if (registered) retained.push(checkoutPath);
    else {
      try { rmdirSync(checkoutPath); }
      catch (error) { if (error.code !== 'ENOENT') retained.push(checkoutPath); }
    }
  }
  for (const name of ['context.json', 'launch-args']) {
    const path = join(sessionDir, name);
    try { unlinkSync(path); }
    catch (error) { if (error.code !== 'ENOENT') retained.push(path); }
  }
  try { rmdirSync(sessionDir); }
  catch (error) { if (error.code !== 'ENOENT') retained.push(sessionDir); }
  if (retained.length) throw Error(`Could not safely remove review resources: ${retained.join(', ')}. Inspect them and use git worktree remove for retained worktrees.`);
}
