import { mkdtempSync, mkdirSync, realpathSync, existsSync, rmdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { git, run, save } from './common.mjs';

export function parsePR(url) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/.exec(url || '');
  if (!match || ['.', '..'].includes(match[1]) || ['.', '..'].includes(match[2])
    || !Number.isSafeInteger(Number(match[3]))) throw Error('Expected https://github.com/OWNER/REPO/pull/NUMBER');
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
export function remoteRepository(url) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)?(?:\.git)?\/?$/.exec(url || '');
  return match?.[1]?.toLowerCase();
}
export function assertRelationship(target, remotes, repositories) {
  if (!remotes.some(name => name === target || repositories[name]?.parent?.full_name?.toLowerCase() === target))
    throw Error('PR repository is neither a current remote nor its upstream parent');
}
export function assertPinned(metadata, headSha, baseSha) {
  if (metadata.state !== 'open' || metadata.head.sha !== headSha || metadata.base.sha !== baseSha)
    throw Error('PR head or base moved during preparation. Run codex-review-pr again.');
}
export function prepare(url, { cwd = process.cwd(), worktreeRoot = join(homedir(), '.local/share/codex-review/worktrees'),
  contextRoot = tmpdir(), api = endpoint => JSON.parse(run('gh', ['api', endpoint])), gitCommand = git } = {}) {
  const identity = parsePR(url), target = `${identity.owner}/${identity.repo}`.toLowerCase();
  const source = realpathSync(gitCommand(cwd, 'rev-parse', '--show-toplevel'));
  const remotes = gitCommand(source, 'remote').split('\n').filter(Boolean)
    .map(name => remoteRepository(gitCommand(source, 'remote', 'get-url', name))).filter(Boolean);
  const repositories = {};
  if (!remotes.includes(target)) {
    for (const name of remotes) {
      try { repositories[name] = api(`repos/${name}`); } catch { continue; }
      if (repositories[name]?.parent?.full_name?.toLowerCase() === target) break;
    }
  }
  assertRelationship(target, remotes, repositories);
  const endpoint = `repos/${identity.owner}/${identity.repo}/pulls/${identity.number}`;
  const metadata = api(endpoint);
  if (metadata.state !== 'open' || metadata.base.repo.full_name.toLowerCase() !== target) throw Error('Expected an open PR in the target repository');
  if (!/^[A-Za-z0-9._/-]+$/.test(metadata.base.ref)) throw Error('Unsafe base ref');
  gitCommand(source, 'check-ref-format', `refs/heads/${metadata.base.ref}`);
  const remote = `https://github.com/${identity.owner}/${identity.repo}.git`;
  const headSha = metadata.head.sha, baseSha = metadata.base.sha;
  for (const sha of [headSha, baseSha]) {
    if (!/^[0-9a-f]{40}$/.test(sha || '')) throw Error('Invalid commit SHA in PR metadata');
  }
  // Independent launches share the object database, but never FETCH_HEAD or refs.
  gitCommand(source, 'fetch', '--no-tags', '--no-write-fetch-head', '--refmap=', remote,
    `refs/pull/${identity.number}/head`, `refs/heads/${metadata.base.ref}`);
  for (const sha of [headSha, baseSha]) gitCommand(source, 'cat-file', '-e', `${sha}^{commit}`);
  const mergeBase = gitCommand(source, 'merge-base', baseSha, headSha);
  assertPinned(api(endpoint), headSha, baseSha);
  const createdRoots = [];
  const allocateRoot = path => {
    const missing = [];
    for (let p = resolve(path); !existsSync(p); p = dirname(p)) missing.push(p);
    for (const directory of missing.reverse()) {
      try { mkdirSync(directory, { mode: 0o700 }); createdRoots.push(directory); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return realpathSync(path);
  };
  let checkoutPath, contextDir, worktreeAttempted = false;
  try {
    const root = allocateRoot(worktreeRoot), contexts = allocateRoot(contextRoot);
    checkoutPath = realpathSync(mkdtempSync(join(root, `${identity.repo}-${identity.number}-`)));
    worktreeAttempted = true;
    gitCommand(source, 'worktree', 'add', '--detach', checkoutPath, headSha);
    contextDir = realpathSync(mkdtempSync(join(contexts, 'codex-review-')));
    const context = { version: 1, pr: { ...identity, title: metadata.title, body: metadata.body || '', author: metadata.user.login,
      state: metadata.state, baseRef: metadata.base.ref, headSha, url,
      mergeable: metadata.mergeable, mergeableState: metadata.mergeable_state }, checkoutPath, baseSha, mergeBase,
      baseAheadCount: Number(gitCommand(source, 'rev-list', '--count', `${mergeBase}..${baseSha}`)) };
    const contextFile = join(contextDir, 'context.json');
    save(contextFile, context);
    return { ...context, contextFile };
  } catch (error) {
    const retained = [];
    if (contextDir) {
      try { rmSync(contextDir, { recursive: true }); } catch { retained.push(contextDir); }
    }
    if (checkoutPath) {
      let registered = false;
      if (worktreeAttempted) {
        try { gitCommand(source, 'worktree', 'remove', checkoutPath); }
        catch {
          // Failed adds can leave an empty, unregistered directory. Never
          // discard a still-registered worktree after non-forced removal fails.
          try { registered = gitCommand(source, 'worktree', 'list', '--porcelain', '-z').split('\0').includes(`worktree ${checkoutPath}`); }
          catch { registered = true; }
        }
      }
      if (registered) retained.push(checkoutPath);
      else if (existsSync(checkoutPath)) {
        try { rmdirSync(checkoutPath); } catch { retained.push(checkoutPath); }
      }
    }
    for (const path of createdRoots.reverse()) {
      if (!existsSync(path)) continue;
      try { rmdirSync(path); } catch { retained.push(path); }
    }
    if (retained.length) error.message += `\nCould not safely remove preparation resources: ${retained.join(', ')}. Inspect them and use git worktree remove for retained worktrees.`;
    throw error;
  }
}
