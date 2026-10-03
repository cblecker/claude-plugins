import type { RunState } from './types'

// How a review run ends before it finishes: the pane's cancel, a session that ends
// (/clear, /resume, exit), and a reload that finds a run mid-post. Pure: every change
// takes the run as it is at the write and returns it unchanged when it does not apply.
// The hooks files own `$`: they stop the workflow with TaskStop and write the state.

export const CANCELLED = 'Cancelled'
export const POSTING_REFUSAL = 'Posting is in progress; wait for it to finish.'
export const INTERRUPTED = 'Posting was interrupted; check the PR.'

// What a session end stops: the workflow of a run still in progress. Any later phase
// has no workflow running.
export function cleanupPlan(run: RunState | null): { stop: string | null } {
  return run?.phase === 'progress' && run.taskId ? { stop: run.taskId } : { stop: null }
}

// The pane's cancel. Open while the run is in progress (synthesizing included), on the
// board, drafting or previewing; refused while posting, since a post cannot be taken
// back. A stopped workflow sends no completion notice, so the phase is set here. The
// taskId stays, so a notice already on its way is still recognised and rewritten, and
// `synthesizing` goes, so a board still being built is dropped (finishable). `stop` is
// the workflow to TaskStop. A run that is already done or failed has nothing to cancel.
export type Cancel = { run: RunState | null; stop: string | null; refused?: string }
export function cancelRun(run: RunState | null): Cancel {
  if (!run) return { run, stop: null }
  if (run.phase === 'posting') return { run, stop: null, refused: POSTING_REFUSAL }
  if (!cancellable(run)) return { run, stop: null }
  return { run: { ...run, phase: 'failed', synthesizing: false, error: CANCELLED }, stop: cleanupPlan(run).stop }
}

// Whether the pane offers cancel: the phases a run can still be abandoned in.
export const cancellable = (run: RunState | null): boolean =>
  !!run && (run.phase === 'progress' || run.phase === 'board' || run.phase === 'drafting' || run.phase === 'preview')

// A reload (session.start) loses the module variables a post ran in, so a run found
// posting has no live post. Its outcomes are unknown and no ids were recorded, so it
// ends as done with a warning, never back at a preview that posts the same review again.
export function recoverPosting(run: RunState | null): RunState | null {
  if (!run || run.phase !== 'posting') return run
  return { ...run, phase: 'done', error: INTERRUPTED }
}

// The workflow launch returned `taskId` for the run holding `nonce`. The id is stored.
// A run cancelled in the launch window is no longer in progress: it keeps its phase
// (the launch must not bring it back), and the workflow that started anyway is to be
// stopped (`stop`).
export function launched(run: RunState | null, nonce: string, taskId: string): { run: RunState | null; stop: boolean } {
  if (!run || run.run !== nonce) return { run, stop: false }
  return run.phase === 'progress'
    ? { run: { ...run, taskId }, stop: false }
    : { run: { ...run, taskId }, stop: true }
}
