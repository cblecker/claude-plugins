import type { RunState } from './types'

// The workflow's completion notice, as Claude Code delivers it: a `<task-notification>`
// block carrying `<task-id>`, `<status>` and the workflow's `<result>`. Only the exact
// `<task-id>` tag of our own taskId counts: other attachments (an edited file) can
// quote the id as plain text.
export function noticeFor(text: string, taskId?: string): { status: string } | null {
  if (!taskId || !String(text).includes(`<task-id>${taskId}</task-id>`)) return null
  return { status: (/<status>([^<]+)<\/status>/.exec(text) || [])[1]?.trim() || 'unknown' }
}

export function completionLine(ok: boolean, status: string): string {
  return ok ? 'Review complete — the board is open in the review pane.' : `Review failed: ${status} — see the review pane.`
}

// What the hooks do with a notice's text: the one line that replaces it, or null to
// pass it through (another task's notice, or no run to match).
export function rewriteNotice(text: string, run: Pick<RunState, 'taskId'> | null | undefined): { line: string; ok: boolean; status: string } | null {
  const hit = noticeFor(text, run?.taskId)
  if (!hit) return null
  const ok = hit.status === 'completed'
  return { line: completionLine(ok, hit.status), ok, status: hit.status }
}

// The first notice for a run still in progress claims it: a completed one marks the
// run `synthesizing` (the board follows), any other status fails it. A duplicate, a
// notice for another task, or a run past progress is not claimed and changes nothing.
export function claimNotice(cur: RunState | null, taskId: string, ok: boolean, status: string): { run: RunState | null; claimed: boolean } {
  if (!cur || cur.taskId !== taskId || cur.phase !== 'progress' || cur.synthesizing) return { run: cur, claimed: false }
  const run: RunState = ok ? { ...cur, synthesizing: true } : { ...cur, phase: 'failed', error: `Workflow ${status}` }
  return { run, claimed: true }
}

// A selected lens without an accepted deposit failed; a follow-up with no verdicts
// means the verifier failed.
export function lensOutcome(run: RunState): { failed: string[]; verifierFailed: boolean } {
  return { failed: run.lenses.map((l) => l.name).filter((n) => !run.deposits[n]), verifierFailed: !!run.followUp && !run.verdicts }
}

// The run with its lens outcome recorded where the board reads it.
export function withOutcome(run: RunState): RunState {
  const out = lensOutcome(run)
  return { ...run, failedLenses: out.failed, verifierFailed: out.verifierFailed }
}
