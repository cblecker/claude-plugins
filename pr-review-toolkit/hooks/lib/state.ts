// NOTE (validator/host scan, verified on 2.1.287): `$` is followed only into
// functions declared in the same file as the hook, never across an import, and
// `read`/`update` need an atom declared in that same file (or an inline
// { plugin, key } literal). A hook file that imports getRun/setRun/runAtom from
// here and passes `$` to them is rejected by `claude plugin validate`. What does
// pass: a file that declares the atom and its helpers itself, including a lib
// function that takes `on` and registers hooks using its own atom.
import { atom, read, update } from 'claude-code'
import type { RunState } from './types'
export const runAtom = atom({ plugin: 'pr-review-toolkit', key: 'run' }, null as RunState | null)
export async function getRun($: any): Promise<RunState | null> { return read($, runAtom) }
export async function setRun($: any, fn: (r: RunState | null) => RunState | null) { await update($, runAtom, fn) }
