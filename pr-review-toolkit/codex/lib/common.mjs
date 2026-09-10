import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

export const save = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
export function run(command, args, cwd = process.cwd()) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export const git = (cwd, ...args) => run('git', args, cwd);
