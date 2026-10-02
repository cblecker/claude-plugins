import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { RunState } from './lib/types'
import { applyDeposit } from './lib/deposit'

// `$` never crosses a file import: read/update need an atom declared in the same
// file as the hooks that use them, so each hooks file declares its own.
const runAtom = atom({ plugin: 'pr-review-toolkit', key: 'run' }, null as RunState | null)
async function getRun($: Parameters<typeof read>[0]): Promise<RunState | null> { return read($, runAtom) }
async function setRun($: Parameters<typeof update>[0], fn: (r: RunState | null) => RunState | null) { await update($, runAtom, fn) }

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'submit_findings',
      description: 'Internal to review-pr: a review lens agent reports its findings here. Not for the main conversation.',
      inputSchema: { type: 'object', required: ['run', 'lens', 'findings', 'positiveObservations'], properties: {
        run: { type: 'string' }, lens: { type: 'string' },
        findings: { type: 'array', items: { type: 'object' } },
        positiveObservations: { type: 'array', items: { type: 'string' } } } },
    })
    await $.tool.register({
      name: 'submit_followup',
      description: 'Internal to review-pr: the follow-up verifier reports its verdicts here. Not for the main conversation.',
      inputSchema: { type: 'object', required: ['run', 'items'], properties: { run: { type: 'string' }, items: { type: 'array', items: { type: 'object' } } } },
    })
    return next(e)
  })

  // The deposit tools answer themselves: validate against the run's nonce and
  // selected lenses, store by lens, and tell the agent whether it was accepted.
  on('tool.call', { tool: 'mcp__pr-review-toolkit__submit_findings' }, async ($, e) => {
    let answer = 'rejected: unknown run'
    await setRun($, (r) => { const out = applyDeposit(r, e, 'findings'); answer = out.answer; return out.run })
    return { result: answer }
  })
  on('tool.call', { tool: 'mcp__pr-review-toolkit__submit_followup' }, async ($, e) => {
    let answer = 'rejected: unknown run'
    await setRun($, (r) => { const out = applyDeposit(r, e, 'followup'); answer = out.answer; return out.run })
    return { result: answer }
  })
}
