import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prepare, parsePR, remoteRepository } from '../lib/prepare.mjs';
import { git } from '../lib/common.mjs';
import { fixture, snapshot } from './helpers.mjs';

const execute = promisify(execFile);
const url = 'https://github.com/upstream/repo/pull/1';

test('validates PR URLs and recognizes HTTPS and SSH repositories', () => {
  assert.deepEqual(parsePR(url), { owner: 'upstream', repo: 'repo', number: 1 });
  for (const bad of ['https://github.com/a/b/pull/0', 'https://github.com/../b/pull/1',
    'https://example.com/a/b/pull/1', 'https://github.com/a/b/pull/9007199254740992'])
    assert.throws(() => parsePR(bad), /Expected/);
  for (const remote of ['https://github.com/A/B.git', 'git@github.com:A/B.git', 'ssh://git@github.com/A/B.git',
    'https://user@github.com/A/B.git', 'https://user:token@github.com/A/B.git',
    'https://user%3Fname:token%23secret@github.com/A/B.git', 'ssh://git@github.com:22/A/B.git',
    'https://GITHUB.COM/A/B.git', 'https://User:Token@GitHub.Com/A/B.git',
    'https://user%3Fname:token%23secret@GitHub.Com/A/B.git', 'git@GITHUB.COM:A/B.git',
    'ssh://git@GitHub.Com/A/B.git', 'ssh://git@GITHUB.COM:22/A/B.git'])
    assert.equal(remoteRepository(remote), 'a/b', remote);
  for (const remote of ['https://elsewhere.com/a/b', 'https://user:token@elsewhere.com/a/b',
    'https://example.com?next=@github.com/upstream/repo.git',
    'https://example.com#@github.com/upstream/repo.git',
    'https://example.com?next=@GITHUB.COM/upstream/repo.git',
    'https://example.com#@GitHub.Com/upstream/repo.git',
    'https://GITHUB.COM.example.com/a/b.git', 'https://fakeGITHUB.COM/a/b.git',
    'git@GITHUB-WORK:a/b.git', 'ssh://git@GITHUB.COM.example.com/a/b.git'])
    assert.equal(remoteRepository(remote), undefined, remote);
});
test('default API targets github.com for fork lookup and both PR reads despite GH_HOST', async t => {
  const { options, root, remote, metadata, head } = fixture(t, { fork: true });
  const bin = join(root, 'bin'), capture = join(root, 'api-calls');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2), hostIndex = args.indexOf('--hostname');
const host = hostIndex < 0 ? process.env.GH_HOST : args[hostIndex + 1];
const endpoint = args.at(-1);
appendFileSync(process.env.API_CAPTURE, JSON.stringify({ host, endpoint }) + '\\n');
if (args[0] !== 'api' || host !== 'github.com') throw Error('Unexpected API host');
if (endpoint === 'repos/user/repo') console.log(JSON.stringify({ parent: { full_name: 'upstream/repo' } }));
else if (endpoint === 'repos/upstream/repo/pulls/1') console.log(JSON.stringify(${JSON.stringify(metadata)}));
else throw Error('Unexpected API endpoint');
`, { mode: 0o700 });
  const module = new URL('../lib/prepare.mjs', import.meta.url).href;
  const helpers = new URL('../lib/common.mjs', import.meta.url).href;
  const script = `import { prepare } from ${JSON.stringify(module)};
    import { git } from ${JSON.stringify(helpers)};
    const input = JSON.parse(process.argv[1]);
    const result = prepare(input.url, { ...input.options,
      gitCommand(cwd, ...args) { return git(cwd, ...args.map(a =>
        a === 'https://github.com/upstream/repo.git' ? input.remote : a)); }
    }); console.log(JSON.stringify(result));`;
  const result = await execute(process.execPath, ['--input-type=module', '-e', script,
    JSON.stringify({ url, options, remote })], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_HOST: 'enterprise.example.invalid', API_CAPTURE: capture }
  });
  assert.equal(JSON.parse(result.stdout).pr.headSha, head);
  assert.deepEqual(readFileSync(capture, 'utf8').trim().split('\n').map(line => JSON.parse(line)),
    ['repos/user/repo', 'repos/upstream/repo/pulls/1', 'repos/upstream/repo/pulls/1']
      .map(endpoint => ({ host: 'github.com', endpoint })));
});
for (const ref of ['feature@review', 'feature+review', 'révision']) test(`prepares a valid base branch: ${ref}`, t => {
  const { options, source, remote, metadata, base, head, calls } = fixture(t);
  git(source, 'push', remote, `${base}:refs/heads/${ref}`);
  metadata.base.ref = ref;
  const result = prepare(url, options);
  assert.equal(result.baseSha, base);
  assert.equal(result.pr.headSha, head);
  assert.equal(calls.find(args => args[0] === 'fetch').at(-1), `refs/heads/${ref}`);
});
test('rejects invalid refs and non-string base metadata before fetching', t => {
  const { options, metadata, calls } = fixture(t);
  for (const ref of ['', 'feature~review', 'bad:ref', 'bad..ref', 'bad ref', 'feature@{1}',
    null, undefined, 123, ['main'], {}]) {
    metadata.base.ref = ref;
    assert.throws(() => prepare(url, options), typeof ref === 'string' ? /check-ref-format/ : /Unsafe base ref/);
  }
  assert.ok(!calls.some(args => args[0] === 'fetch' || args[0] === 'worktree'));
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
test('preserves non-404 lookup errors containing not found', t => {
  const { options } = fixture(t, { fork: true });
  for (const field of ['message', 'stderr']) {
    for (const detail of ['token not found', 'helper: command not found',
      'HTTP 401: authentication token not found', 'HTTP 502: upstream not found',
      'HTTP 4040: malformed status not found']) {
      options.api = () => { throw Object.assign(Error('gh api failed'), { [field]: detail }); };
      assert.throws(() => prepare(url, options),
        error => /repository lookup failed/.test(error.message) && error.message.includes(detail), `${field}: ${detail}`);
    }
  }
});
test('a missing repository keeps the plain relationship message', t => {
  const { options } = fixture(t, { fork: true });
  for (const field of ['message', 'stderr']) {
    options.api = () => { throw Object.assign(Error('gh api failed'), { [field]: 'gh: Not Found (HTTP 404)' }); };
    assert.throws(() => prepare(url, options),
      error => /neither/.test(error.message) && !/lookup failed/.test(error.message), field);
  }
});
for (const fork of [false, true]) test(`prepares pins from ${fork ? 'fork' : 'upstream'} without changing dirty checkout`, t => {
  const { options, source, head, base, calls } = fixture(t, { fork });
  const before = snapshot(source);
  const result = prepare(url, options);
  assert.equal(result.pr.headSha, head);
  assert.equal(result.version, 2);
  assert.equal(result.sourceCheckout, source);
  assert.equal(result.sourceHead, head);
  assert.equal(result.commonGitDir, realpathSync(join(source, '.git')));
  assert.equal(result.mergeBase, base);
  assert.deepEqual(Object.keys(result.pr).sort(), ['headSha', 'number', 'owner', 'repo', 'url']);
  assert.deepEqual(snapshot(source), before);
  assert.equal(readFileSync(join(source, 'file.txt'), 'utf8'), 'keep tracked edits\n');
  assert.deepEqual(calls.filter(args => args[0] === 'fetch'), [
    ['fetch', '--no-tags', '--no-write-fetch-head', '--refmap=', 'https://github.com/upstream/repo.git', 'refs/pull/1/head', 'refs/heads/main']
  ]);
});
test('concurrent preparations leave source state and shared FETCH_HEAD intact', async t => {
  const { options, source, remote, metadata, head } = fixture(t);
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
  const before = snapshot(source);
  const runs = await Promise.all([1, 2].map(() =>
    execute(process.execPath, ['--input-type=module', '-e', script,
      JSON.stringify({ url, options, metadata, remote })])));
  const [first, second] = runs.map(run => JSON.parse(run.stdout));
  assert.deepEqual(first, second);
  assert.equal(first.pr.headSha, head);
  assert.deepEqual(snapshot(source), before);
  assert.equal(readFileSync(fetchHead, 'utf8'), 'another operation owns this\n');
});
for (const change of ['head', 'base', 'closed']) test(`stops before checkout when PR ${change} changes`, t => {
  const { options, metadata, source } = fixture(t);
  const before = snapshot(source);
  let reads = 0;
  options.api = () => {
    if (++reads === 1) return metadata;
    return change === 'closed' ? { ...metadata, state: 'closed' }
      : { ...metadata, [change]: { ...metadata[change], sha: 'f'.repeat(40) } };
  };
  assert.throws(() => prepare(url, options), /moved/);
  assert.deepEqual(snapshot(source), before);
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
});
test('canonicalizes a source checkout reached through a symlink', t => {
  const { options, source, root } = fixture(t);
  const alias = join(root, 'alias');
  symlinkSync(source, alias);
  const result = prepare(url, { ...options, cwd: alias });
  assert.equal(result.sourceCheckout, source);
});

test('fetches missing PR objects into a clone without changing source state', t => {
  const { options, root, remote, head } = fixture(t);
  const clone = join(root, 'base-only');
  git(root, 'clone', '--no-local', '--single-branch', '--branch', 'main', remote, clone);
  git(clone, 'remote', 'set-url', 'origin', 'git@github.com:upstream/repo.git');
  assert.throws(() => git(clone, 'cat-file', '-e', `${head}^{commit}`));
  const before = snapshot(clone);
  const result = prepare(url, { ...options, cwd: clone });
  assert.equal(result.pr.headSha, head);
  assert.equal(git(clone, 'cat-file', '-t', head), 'commit');
  assert.deepEqual(snapshot(clone), before);
});

test('preparation CLI emits compact JSON and scopes HTTPS authentication to child commands', async t => {
  const { root, source, remote, metadata, head } = fixture(t);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  // The fixtures demand the process token; Git still performs a real local fetch.
  const realGit = (await execute('which', ['git'])).stdout.trim();
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
if (process.env.GH_TOKEN !== 'fixture-token') throw Error('missing API authentication');
if (process.argv.slice(2).join(' ') !== 'api --hostname github.com repos/upstream/repo/pulls/1')
  throw Error('unexpected API call');
console.log(JSON.stringify(${JSON.stringify(metadata)}));
`, { mode: 0o700 });
  writeFileSync(join(bin, 'git'), `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'fetch') {
  if (!args.includes('https://github.com/upstream/repo.git')) throw Error('expected HTTPS fetch');
  if (process.env.GH_TOKEN !== 'fixture-token') throw Error('missing HTTPS authentication');
}
const result = spawnSync(${JSON.stringify(realGit)}, args.map(arg =>
  arg === 'https://github.com/upstream/repo.git' ? ${JSON.stringify(remote)} : arg), { stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o700 });
  const before = snapshot(source);
  const result = await execute(process.execPath, [fileURLToPath(new URL('../bin/prepare.mjs', import.meta.url)), url], {
    cwd: source, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: 'fixture-token' }
  });
  const context = JSON.parse(result.stdout);
  assert.equal(context.version, 2);
  assert.equal(context.pr.headSha, head);
  assert.equal(result.stdout, JSON.stringify(context) + '\n');
  assert.ok(!result.stdout.includes('fixture-token'));
  assert.deepEqual(snapshot(source), before);
});
