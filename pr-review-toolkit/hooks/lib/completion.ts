import type { RunState } from './types'

// The workflow's completion notice, as Claude Code delivers it: a `<task-notification>`
// block carrying `<task-id>`, `<status>` and the workflow's `<result>`. Only the exact
// `<task-id>` tag of our own taskId counts: other attachments (an edited file) can
// quote the id as plain text. A text can hold several notices (other tasks'), so the
// status is read inside our block only. A text with no wrapper at all is taken whole.
const readStatus = (s: string): string => (/<status>([^<]+)<\/status>/.exec(s) || [])[1]?.trim() || 'unknown'
const blocks = (s: string): string[] | null => s.match(/<task-notification>[\s\S]*?<\/task-notification>/g)

function locate(text: string, taskId?: string): { status: string; replaceWith: (line: string) => string } | null {
  const src = String(text)
  const tag = `<task-id>${taskId}</task-id>`
  if (!taskId || !src.includes(tag)) return null
  const all = blocks(src)
  if (!all) return { status: readStatus(src), replaceWith: (line) => line }
  const ours = all.find((b) => b.includes(tag))
  if (!ours) return null
  return { status: readStatus(ours), replaceWith: (line) => src.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, (b) => (b.includes(tag) ? line : b)) }
}

export function noticeFor(text: string, taskId?: string): { status: string } | null {
  const hit = locate(text, taskId)
  return hit ? { status: hit.status } : null
}

export function completionLine(ok: boolean, status: string): string {
  return ok ? 'Review complete — the board is opening in the review pane.' : `Review failed: ${status} — see the review pane.`
}

// What the hooks do with a notice's text: the full new text (our notice replaced by the
// one line, any surrounding text kept) with the status it carried, or null to pass the
// text through (another task's notice, or no run to match).
export function rewriteNotice(text: string, run: Pick<RunState, 'taskId'> | null | undefined): { text: string; line: string; ok: boolean; status: string } | null {
  const hit = locate(text, run?.taskId)
  if (!hit) return null
  const ok = hit.status === 'completed'
  const line = completionLine(ok, hit.status)
  return { text: hit.replaceWith(line), line, ok, status: hit.status }
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

// A detached finish may write only onto the run its notice claimed: same taskId, still
// in progress, and synthesizing (a cancel clears that flag, a newer run has another id).
export function finishable(run: RunState | null, taskId: string): run is RunState {
  return run?.taskId === taskId && run.phase === 'progress' && !!run.synthesizing
}

// The claimed run, failed because its board could not be built; any other run is untouched.
export function failSynthesis(run: RunState | null, taskId: string, why: string): RunState | null {
  return finishable(run, taskId) ? { ...run, phase: 'failed', synthesizing: false, error: `Review board failed: ${why}` } : run
}
