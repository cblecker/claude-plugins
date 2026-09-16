import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../lib/common.mjs';

const identity = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
export function fixture(t, { fork = false, unrelatedHistory = false } = {}) {
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'review preparation $(literal) ')));
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
  const options = { cwd: source,
    api: endpoint => endpoint === 'repos/user/repo' ? { parent: { full_name: 'upstream/repo' } } : metadata,
    gitCommand(cwd, ...args) {
      calls.push(args);
      return git(cwd, ...args.map(arg => arg === 'https://github.com/upstream/repo.git' ? remote : arg));
    } };
  return { root, source, remote, metadata, calls, options, base, head };
}

export function snapshot(cwd) {
  const files = directory => readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.name !== '.git').flatMap(entry => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? files(path) : [[path, readFileSync(path).toString('base64')]];
    });
  return {
    files: files(cwd),
    index: readFileSync(git(cwd, 'rev-parse', '--path-format=absolute', '--git-path', 'index')).toString('base64'),
    head: git(cwd, 'rev-parse', 'HEAD'),
    branch: git(cwd, 'branch', '--show-current'),
    refs: git(cwd, 'show-ref'),
    worktrees: git(cwd, 'worktree', 'list', '--porcelain', '-z'),
    status: git(cwd, 'status', '--porcelain')
  };
}
