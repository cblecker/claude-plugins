import type { FollowUpContext, PrMeta, RunState } from './types'

// The run nonce the lens agents quote when they deposit.
export const newNonce = (now: number): string => 'r' + now.toString(36)

// What the analysis workflow receives as `args` in place of Claude's `{ pr }`.
export type LaunchArgs = {
  run: string
  pr: Pick<PrMeta, 'owner' | 'repo' | 'number' | 'title' | 'body' | 'author' | 'baseRef' | 'headSha'>
  checkoutPath: string
  mergeBase: string
  shape: RunState['summary']
  lenses: { name: string; effort: string }[]
  followUp: FollowUpContext | null
}
export type LaunchGate = { deny: string } | { args: LaunchArgs; nonce: string }

// A launched run whose workflow has not finished, or a review being posted: it must
// not be replaced or relaunched.
export function inFlightError(run: RunState | null): string | null {
  if (run?.phase === 'posting') return `The review of ${run.handle} is being posted; wait for posting to finish.`
  return run && run.taskId && run.phase === 'progress'
    ? `A review run is already in progress for ${run.handle}; cancel it in the review pane first.`
    : null
}

// Whether the analysis workflow may launch for `args.pr`, and with what. A preparation
// launches once: a nonce without a taskId is a launch under way (or one cut off by a
// reload), and a taskId is a launch that happened. `currentHead` is HEAD in the run's
// checkout, '' when it could not be read.
export function launchGate(run: RunState | null, args: unknown, currentHead: string, now: number): LaunchGate {
  if (!run) return { deny: 'Run prepare_review first; no review is prepared in this session.' }
  if (run.taskId || run.run) return { deny: inFlightError(run) ?? 'This preparation was already used; run prepare_review again.' }
  // Only a cancel ends a run that never launched. The agent is told to stop, not to prepare
  // again: the person has just declined this review.
  if (run.phase !== 'progress') return { deny: 'The person cancelled this review in the review pane. Stop; do not prepare or launch it again unless they ask.' }
  const pr = args && typeof args === 'object' && typeof (args as { pr?: unknown }).pr === 'string' ? (args as { pr: string }).pr : ''
  if (!pr) return { deny: `args.pr is missing; pass the handle prepare_review returned (${run.handle}).` }
  if (pr !== run.handle) return { deny: `This review was prepared for ${run.handle}, not ${pr}. Run prepare_review again.` }
  if (!currentHead) return { deny: `Could not read HEAD in ${run.checkoutPath}. Run prepare_review again from the PR checkout.` }
  if (currentHead !== run.pr.headSha) {
    return { deny: `HEAD in ${run.checkoutPath} is now ${currentHead}, not ${run.pr.headSha} as prepared. Run prepare_review again.` }
  }
  const nonce = newNonce(now)
  const p = run.pr
  return {
    nonce,
    args: {
      run: nonce,
      pr: { owner: p.owner, repo: p.repo, number: p.number, title: p.title, body: p.body, author: p.author, baseRef: p.baseRef, headSha: p.headSha },
      checkoutPath: run.checkoutPath,
      mergeBase: run.mergeBase,
      shape: run.summary,
      lenses: run.lenses.map((l) => ({ name: l.name, effort: l.effort })),
      followUp: run.followUp,
    },
  }
}
