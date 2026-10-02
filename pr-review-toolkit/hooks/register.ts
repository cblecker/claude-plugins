import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { RunState } from './lib/types'

// `$` never crosses a file import: read/update need an atom declared in the same
// file as the hooks that use them, so each hooks file declares its own.
const runAtom = atom({ plugin: 'pr-review-toolkit', key: 'run' }, null as RunState | null)
async function getRun($: Parameters<typeof read>[0]): Promise<RunState | null> { return read($, runAtom) }
async function setRun($: Parameters<typeof update>[0], fn: (r: RunState | null) => RunState | null) { await update($, runAtom, fn) }

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => next(e))
}
