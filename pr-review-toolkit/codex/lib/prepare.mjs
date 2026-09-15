import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { git, run, save } from './common.mjs';
import { createSession, cleanupSession } from './session.mjs';

export function parsePR(url) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/.exec(url || '');
  if (!match || ['.', '..'].includes(match[1]) || ['.', '..'].includes(match[2])
    || !Number.isSafeInteger(Number(match[3]))) throw Error('Expected https://github.com/OWNER/REPO/pull/NUMBER');
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}
export function remoteRepository(url) {
  const match = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)?(?:\.git)?\/?$/.exec(url || '');
  return match?.[1]?.toLowerCase();
}
export function assertRelationship(target, remotes, repositories, lookupError) {
  if (remotes.some(name => name === target || repositories[name]?.parent?.full_name?.toLowerCase() === target)) return;
  // A failed lookup, such as expired credentials, is indistinguishable from an
  // unrelated repository unless the underlying error is reported.
  const detail = lookupError ? ` (repository lookup failed: ${(lookupError.stderr || lookupError.message || '').trim()})` : '';
  throw Error(`PR repository is neither a current remote nor its upstream parent${detail}`);
}
export function assertPinned(metadata, headSha, baseSha) {
  if (metadata.state !== 'open' || metadata.head.sha !== headSha || metadata.base.sha !== baseSha)
    throw Error('PR head or base moved during preparation. Run codex-review-pr again.');
}
export function prepare(url, { cwd = process.cwd(), sessionDir,
  api = endpoint => JSON.parse(run('gh', ['api', endpoint])), gitCommand = git } = {}) {
  const identity = parsePR(url), target = `${identity.owner}/${identity.repo}`.toLowerCase();
  const source = realpathSync(gitCommand(cwd, 'rev-parse', '--show-toplevel'));
  const remoteUrls = gitCommand(source, 'remote').split('\n').filter(Boolean)
    .map(name => gitCommand(source, 'remote', 'get-url', name));
  const remotes = remoteUrls.map(url => remoteRepository(url)).filter(Boolean);
  // Host aliases such as git@github-work:OWNER/REPO are never guessed.
  if (remoteUrls.length && !remotes.length)
    throw Error('No remote points at github.com. Recognized forms: https://github.com/OWNER/REPO, git@github.com:OWNER/REPO, ssh://git@github.com/OWNER/REPO');
  const repositories = {};
  let lookupError;
  if (!remotes.includes(target)) {
    for (const name of remotes) {
      try { repositories[name] = api(`repos/${name}`); }
      catch (error) {
        // A missing repository is expected; anything else is worth reporting.
        if (!/HTTP 404|not found/i.test(`${error.stderr || ''} ${error.message || ''}`)) lookupError = error;
        continue;
      }
      if (repositories[name]?.parent?.full_name?.toLowerCase() === target) break;
    }
  }
  assertRelationship(target, remotes, repositories, lookupError);
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
  sessionDir = sessionDir ? realpathSync(sessionDir) : createSession();
  const checkoutPath = join(sessionDir, 'checkout');
  try {
    gitCommand(source, 'worktree', 'add', '--detach', checkoutPath, headSha);
    const context = { version: 1, pr: { ...identity, title: metadata.title, body: metadata.body || '', author: metadata.user.login,
      state: metadata.state, baseRef: metadata.base.ref, headSha, url,
      mergeable: metadata.mergeable, mergeableState: metadata.mergeable_state }, checkoutPath, baseSha, mergeBase,
      baseAheadCount: Number(gitCommand(source, 'rev-list', '--count', `${mergeBase}..${baseSha}`)) };
    const contextFile = join(sessionDir, 'context.json');
    save(contextFile, context);
    return { ...context, contextFile };
  } catch (error) {
    try { cleanupSession(sessionDir, { cwd: source, gitCommand }); }
    catch (cleanupError) { error.message += `\n${cleanupError.message}`; }
    throw error;
  }
}
