import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepare, parsePR, remoteRepository } from '../lib/prepare.mjs';
import { git } from '../lib/common.mjs';
import { createSession, cleanupSession } from '../lib/session.mjs';

const execute = promisify(execFile);
const identity = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
function fixture(t, { fork = false, unrelatedHistory = false } = {}) {
  // The production helper spreads process.env per call, so fixture identity
  // reaches it without a separate command wrapper.
  const previous = Object.fromEntries(Object.keys(identity).map(name => [name, process.env[name]]));
  Object.assign(process.env, identity);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const root = mkdtempSync(join(tmpdir(), 'review preparation '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), remote = join(root, 'remote.git');
  mkdirSync(source);
  git(root, 'init', '--bare', remote);
  git(source, 'init');
  // Build fixture objects without touching user Git configuration or invoking commit hooks.
  writeFileSync(join(source, 'file.txt'), 'base\n');
  git(source, 'add', 'file.txt');
  const base = git(source, 'commit-tree', git(source, 'write-tree'), '-m', 'base fixture');
  writeFileSync(join(source, 'file.txt'), 'head\n');
  git(source, 'add', 'file.txt');
  const head = git(source, 'commit-tree', git(source, 'write-tree'),
    ...(unrelatedHistory ? [] : ['-p', base]), '-m', 'head fixture');
  git(source, 'update-ref', 'HEAD', head);
  git(source, 'push', remote, `${base}:refs/heads/main`, `${head}:refs/pull/1/head`);
  // Remote config is created only by the fixture's repository setup.
  git(source, 'remote', 'add', 'origin', `git@github.com:${fork ? 'user' : 'upstream'}/repo.git`);
  writeFileSync(join(source, 'dirty.txt'), 'keep untracked edits');
  writeFileSync(join(source, 'file.txt'), 'keep tracked edits\n');
  const metadata = { state: 'open', title: 'Review', body: '', user: { login: 'author' }, head: { sha: head },
    base: { sha: base, ref: 'main', repo: { full_name: 'upstream/repo' } } };
  const calls = [];
  const options = { cwd: source, sessionDir: createSession(root),
    api: endpoint => endpoint === 'repos/user/repo' ? { parent: { full_name: 'upstream/repo' } } : metadata,
    gitCommand(cwd, ...args) {
      calls.push(args);
      return git(cwd, ...args.map(arg => arg === 'https://github.com/upstream/repo.git' ? remote : arg));
    } };
  return { root, source, remote, metadata, calls, options, base, head };
}
const url = 'https://github.com/upstream/repo/pull/1';

test('validates PR URLs and recognizes HTTPS and SSH repositories', () => {
  assert.deepEqual(parsePR(url), { owner: 'upstream', repo: 'repo', number: 1 });
  for (const bad of ['https://github.com/a/b/pull/0', 'https://github.com/../b/pull/1',
    'https://example.com/a/b/pull/1', 'https://github.com/a/b/pull/9007199254740992'])
    assert.throws(() => parsePR(bad), /Expected/);
  for (const remote of ['https://github.com/A/B.git', 'git@github.com:A/B.git', 'ssh://git@github.com/A/B.git',
    'https://user@github.com/A/B.git', 'ssh://git@github.com:22/A/B.git'])
    assert.equal(remoteRepository(remote), 'a/b');
  assert.equal(remoteRepository('https://elsewhere.com/a/b'), undefined);
});
test('reports an unusable remote host separately from an unrelated repository', t => {
  const { options, source } = fixture(t);
  git(source, 'remote', 'set-url', 'origin', 'git@github-work:upstream/repo.git');
  assert.throws(() => prepare(url, options), /No remote points at github\.com/);
});
test('reports why a fork parent lookup failed', t => {
  const { options } = fixture(t, { fork: true });
  options.api = () => { throw Error('HTTP 401: Bad credentials'); };
  assert.throws(() => prepare(url, options), error => /neither/.test(error.message) && /Bad credentials/.test(error.message));
});
test('a missing repository keeps the plain relationship message', t => {
  const { options } = fixture(t, { fork: true });
  options.api = () => { throw Error('gh: Not Found (HTTP 404)'); };
  assert.throws(() => prepare(url, options), error => /neither/.test(error.message) && !/lookup failed/.test(error.message));
});
for (const fork of [false, true]) test(`prepares a detached head from ${fork ? 'fork' : 'upstream'} without changing dirty checkout`, t => {
  const { options, source, head, base, calls } = fixture(t, { fork });
  const status = git(source, 'status', '--porcelain');
  const result = prepare(url, options);
  assert.equal(git(result.checkoutPath, 'rev-parse', 'HEAD'), head);
  assert.equal(git(result.checkoutPath, 'status', '--porcelain'), '');
  assert.equal(git(result.checkoutPath, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD');
  assert.equal(result.mergeBase, base);
  assert.equal(JSON.parse(readFileSync(result.contextFile)).pr.headSha, head);
  assert.equal(git(source, 'status', '--porcelain'), status);
  assert.equal(readFileSync(join(source, 'file.txt'), 'utf8'), 'keep tracked edits\n');
  assert.deepEqual(calls.filter(args => args[0] === 'fetch'), [
    ['fetch', '--no-tags', '--no-write-fetch-head', '--refmap=', 'https://github.com/upstream/repo.git', 'refs/pull/1/head', 'refs/heads/main']
  ]);
});
test('concurrent processes leave shared FETCH_HEAD intact and create separate worktrees', async t => {
  const { options, source, remote, metadata, head, root } = fixture(t);
  const fetchHead = join(source, '.git/FETCH_HEAD');
  writeFileSync(fetchHead, 'another operation owns this\n');
  const module = new URL('../lib/prepare.mjs', import.meta.url).href;
  const helpers = new URL('../lib/common.mjs', import.meta.url).href;
  const script = `import { prepare } from ${JSON.stringify(module)};
    import { git } from ${JSON.stringify(helpers)};
    const input = JSON.parse(process.argv[1]);
    const result = prepare(input.url, { ...input.options, api: () => input.metadata,
      gitCommand(cwd, ...args) { return git(cwd, ...args.map(a =>
        a === 'https://github.com/upstream/repo.git' ? input.remote : a)); }
    }); console.log(JSON.stringify(result));`;
  const runs = await Promise.all([options.sessionDir, createSession(root)].map(sessionDir =>
    execute(process.execPath, ['--input-type=module', '-e', script,
      JSON.stringify({ url, options: { ...options, sessionDir }, metadata, remote })])));
  const [first, second] = runs.map(run => JSON.parse(run.stdout));
  assert.notEqual(first.checkoutPath, second.checkoutPath);
  assert.notEqual(first.contextFile, second.contextFile);
  for (const result of [first, second]) assert.equal(git(result.checkoutPath, 'rev-parse', 'HEAD'), head);
  cleanupSession(options.sessionDir, { cwd: source });
  assert.ok(!existsSync(first.checkoutPath));
  assert.equal(git(second.checkoutPath, 'rev-parse', 'HEAD'), head);
  assert.equal(readFileSync(fetchHead, 'utf8'), 'another operation owns this\n');
});
for (const change of ['head', 'base', 'closed']) test(`stops before checkout when PR ${change} changes`, t => {
  const { options, metadata } = fixture(t);
  let reads = 0;
  options.api = () => {
    if (++reads === 1) return metadata;
    return change === 'closed' ? { ...metadata, state: 'closed' }
      : { ...metadata, [change]: { ...metadata[change], sha: 'f'.repeat(40) } };
  };
  assert.throws(() => prepare(url, options), /moved/);
  assert.deepEqual(readdirSync(options.sessionDir), []);
});
test('rejects an unrelated repository', t => {
  const { options } = fixture(t, { fork: true });
  options.api = () => ({ parent: { full_name: 'elsewhere/repo' } });
  assert.throws(() => prepare(url, options), /neither/);
});
test('missing ancestry stops before worktree creation', t => {
  const { options, calls } = fixture(t, { unrelatedHistory: true });
  assert.throws(() => prepare(url, options), /merge-base/);
  assert.ok(!calls.some(args => args[0] === 'worktree'));
});
test('missing pinned commit stops before checkout', t => {
  const { options, metadata } = fixture(t);
  options.api = () => ({ ...metadata, head: { sha: 'f'.repeat(40) } });
  assert.throws(() => prepare(url, options));
  assert.deepEqual(readdirSync(options.sessionDir), []);
});
test('failed worktree add cleans only its empty allocations', t => {
  const { options } = fixture(t);
  const original = options.gitCommand;
  options.gitCommand = (cwd, ...args) => {
    if (args[0] === 'worktree' && args[1] === 'add') {
      mkdirSync(args[3]);
      throw Error('add failed');
    }
    return original(cwd, ...args);
  };
  assert.throws(() => prepare(url, options), /add failed/);
  assert.ok(!existsSync(options.sessionDir));
});
test('post-allocation failure removes its clean worktree and preserves other resources', t => {
  const { options, source, root } = fixture(t);
  const otherSession = createSession(root);
  writeFileSync(join(otherSession, 'keep'), 'existing');
  const original = options.gitCommand;
  options.gitCommand = (cwd, ...args) => {
    if (args[0] === 'rev-list') throw Error('count failed');
    return original(cwd, ...args);
  };
  assert.throws(() => prepare(url, options), /count failed/);
  assert.ok(!existsSync(options.sessionDir));
  assert.equal(readFileSync(join(otherSession, 'keep'), 'utf8'), 'existing');
  assert.equal(git(source, 'worktree', 'list', '--porcelain').split('worktree ').length, 2);
});
test('failed cleanup retains a dirty worktree and reports its path', t => {
  const { options } = fixture(t);
  const original = options.gitCommand;
  let checkout;
  options.gitCommand = (cwd, ...args) => {
    const result = original(cwd, ...args);
    if (args[0] === 'worktree' && args[1] === 'add') {
      checkout = args[3]; writeFileSync(join(checkout, 'keep'), 'new work');
    }
    if (args[0] === 'rev-list') throw Error('count failed');
    return result;
  };
  assert.throws(() => prepare(url, options), error => error.message.includes(checkout) && /Could not safely remove/.test(error.message));
  assert.equal(readFileSync(join(checkout, 'keep'), 'utf8'), 'new work');
});

test('session cleanup removes checkout, registration, and startup files and is repeatable', t => {
  const { options, source } = fixture(t);
  const initialStatus = git(source, 'status', '--porcelain');
  const initialWorktrees = git(source, 'worktree', 'list', '--porcelain', '-z');
  const result = prepare(url, options);
  writeFileSync(join(options.sessionDir, 'launch-args'), 'temporary launch arguments');
  cleanupSession(options.sessionDir, { cwd: source });
  cleanupSession(options.sessionDir, { cwd: source });
  assert.ok(!existsSync(result.checkoutPath));
  assert.ok(!existsSync(options.sessionDir));
  assert.equal(git(source, 'worktree', 'list', '--porcelain', '-z'), initialWorktrees);
  assert.equal(git(source, 'status', '--porcelain'), initialStatus);
});

for (const state of ['tracked', 'untracked', 'locked']) test(`session cleanup retains a ${state} worktree`, t => {
  const { options, source } = fixture(t);
  const result = prepare(url, options);
  if (state === 'locked') git(source, 'worktree', 'lock', result.checkoutPath);
  else writeFileSync(join(result.checkoutPath, state === 'tracked' ? 'file.txt' : 'keep'), 'preserve me');
  assert.throws(() => cleanupSession(options.sessionDir, { cwd: source }),
    error => error.message.includes(result.checkoutPath) && /git worktree remove/.test(error.message));
  assert.ok(existsSync(result.checkoutPath));
  assert.ok(git(source, 'worktree', 'list', '--porcelain', '-z').includes(`worktree ${result.checkoutPath}\0`));
  assert.ok(!existsSync(result.contextFile));
  if (state !== 'locked')
    assert.equal(readFileSync(join(result.checkoutPath, state === 'tracked' ? 'file.txt' : 'keep'), 'utf8'), 'preserve me');
});

test('failed registration lookup preserves even an empty checkout directory', t => {
  const { options } = fixture(t);
  const checkout = join(options.sessionDir, 'checkout');
  mkdirSync(checkout);
  assert.throws(() => cleanupSession(options.sessionDir, { gitCommand() { throw Error('repository unavailable'); } }),
    /Could not safely remove/);
  assert.ok(existsSync(checkout));
});

test('cleanup preserves unexpected files in the session directory', t => {
  const { options, source } = fixture(t);
  const result = prepare(url, options);
  writeFileSync(join(options.sessionDir, 'keep'), 'unexpected work');
  assert.throws(() => cleanupSession(options.sessionDir, { cwd: source }), /Could not safely remove/);
  assert.ok(!existsSync(result.checkoutPath));
  assert.equal(readFileSync(join(options.sessionDir, 'keep'), 'utf8'), 'unexpected work');
});
