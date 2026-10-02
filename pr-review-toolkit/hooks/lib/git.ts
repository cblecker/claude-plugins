import type { Io } from './io'
import { stripOriginCredentials } from './github'

export type Environment = { head: string; root: string; branch: string; origin: string; mergeConfig: string; dirty: string }
export type PinnedRange = {
  mergeBase: string
  baseAheadCount: number
  diff: { nameStatus: string; numstat: string; shortstat: string }
}

// The subcommand for an error message: the first word that is neither an option
// nor the value of `-c <key=value>`.
function subcommand(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c') { i++; continue }
    if (!args[i]!.startsWith('-')) return args[i]!
  }
  return args[0] || ''
}

// Run git and return stdout; a non-zero exit throws with git's stderr.
export async function git(io: Io, args: string[], cwd?: string): Promise<string> {
  const r = await io.run(['git', ...args], cwd ? { cwd, timeoutMs: 120000 } : { timeoutMs: 120000 })
  if (r.exitCode !== 0) throw new Error(`git ${subcommand(args)} failed: ${String(r.stderr || '').trim()}`)
  return String(r.stdout)
}

// The checkout facts the PR resolver needs (the skill's Environment section).
// Origin has any credentials stripped; dirty is trimmed at the end only, so the
// first porcelain line keeps its status columns.
export async function readEnvironment(io: Io): Promise<Environment> {
  const head = (await git(io, ['rev-parse', 'HEAD'])).trim()
  const root = (await git(io, ['rev-parse', '--show-toplevel'])).trim()
  const branch = (await git(io, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const origin = stripOriginCredentials((await git(io, ['remote', 'get-url', 'origin'])).trim())
  let mergeConfig = ''
  // `git config --get-regexp` exits 1 when no branch has a merge key.
  try { mergeConfig = await git(io, ['config', '--get-regexp', '^branch\\..*\\.merge$']) } catch {}
  const dirty = (await git(io, ['status', '--porcelain'])).trimEnd()
  return { head, root, branch, origin, mergeConfig, dirty }
}

// Fetch the base branch, pin the review range and measure base movement against
// FETCH_HEAD. The base ref is remote data, so it is validated before any git call.
export async function pinRange(io: Io, root: string, baseRef: string, head: string): Promise<PinnedRange> {
  if (!/^[A-Za-z0-9._/-]+$/.test(baseRef)) throw new Error(`base ref "${baseRef}" has unexpected characters`)
  await git(io, ['fetch', 'origin', `refs/heads/${baseRef}`], root)
  let mergeBase: string
  try {
    mergeBase = (await git(io, ['merge-base', 'FETCH_HEAD', 'HEAD'], root)).trim()
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : String(e)} (the checkout may be shallow; try \`git fetch --unshallow origin\`)`)
  }
  const baseAheadCount = Number((await git(io, ['rev-list', '--count', 'HEAD..FETCH_HEAD'], root)).trim()) || 0
  const range = `${mergeBase}..${head}`
  const diff = {
    nameStatus: await git(io, ['-c', 'core.quotePath=false', 'diff', '--name-status', range], root),
    numstat: await git(io, ['-c', 'core.quotePath=false', 'diff', '--numstat', range], root),
    shortstat: await git(io, ['diff', '--shortstat', range], root),
  }
  return { mergeBase, baseAheadCount, diff }
}
