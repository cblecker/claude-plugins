import type { RunState } from './types'
import { validateFindings, validateVerdicts } from './validate'

// Apply one lens deposit (kind 'findings') or the follow-up verdicts (kind
// 'followup') to the run. Pure: answers the text the tool returns to the
// model and the run to store; a rejection returns the run it was given.
// A null run (no prepared review) answers like an unknown nonce.
export function applyDeposit(run: RunState, input: any, kind: 'findings' | 'followup'): { answer: string; run: RunState }
export function applyDeposit(run: RunState | null, input: any, kind: 'findings' | 'followup'): { answer: string; run: RunState | null }
export function applyDeposit(run: RunState | null, input: any, kind: 'findings' | 'followup'): { answer: string; run: RunState | null } {
  if (!run || !run.run || input?.run !== run.run) return { answer: 'rejected: unknown run', run }
  if (kind === 'findings' && !run.lenses.some((l) => l.name === input.lens)) {
    return { answer: `rejected: lens "${input.lens}" was not selected for this run. Resubmit with your own lens name.`, run }
  }
  const errors = kind === 'findings' ? validateFindings(input) : validateVerdicts(input)
  if (errors.length) return { answer: `rejected: ${errors.slice(0, 10).join('; ')}. Resubmit.`, run }
  if (kind === 'followup') return { answer: 'accepted', run: { ...run, verdicts: input.items } }
  return {
    answer: 'accepted',
    run: { ...run, deposits: { ...run.deposits, [input.lens]: { findings: input.findings, positiveObservations: input.positiveObservations } } },
  }
}
