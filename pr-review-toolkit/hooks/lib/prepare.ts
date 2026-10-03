import type { Io } from './io'
import type { FollowUpContext, PrMeta, RunState } from './types'
import { pinRange, readEnvironment } from './git'
import type { Environment, PinnedRange } from './git'
import { collectReviews, collectThreads, fetchPr, mcpJson, parseShortstat, resolvePr } from './github'
import { computeDelta, detectFollowUp } from './followup'
import { selectLenses } from './select'
import { inFlightError } from './launch'
import { REVIEWS_FAILED, REVIEWS_PARTIAL, THREADS_FAILED, THREADS_PARTIAL } from './warnings'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// Warnings recorded on the run. The collection ones live in warnings.ts, shared
// with the board.
const NO_LOGIN = 'Your GitHub login could not be read (get_me failed), so follow-up detection is unavailable this run.'
const DIRTY = 'Uncommitted changes are present; file reads see them, the diff does not.'

// The pre-3.0 review-pr workflow's scale rule, over the diff's file count and
// churn (additions + deletions).
export function scaleOf(fileCount: number, churn: number): string {
  return fileCount > 250 || churn > 20000 ? 'very_large'
    : fileCount > 75 || churn > 5000 ? 'large'
      : fileCount > 20 || churn > 1000 ? 'medium'
        : 'small'
}

// The reviewer's GitHub login; null when get_me fails or names none. Never rejects.
async function readLogin(io: Io): Promise<string | null> {
  try {
    const me = await mcpJson(io, 'get_me', {})
    return typeof me?.login === 'string' && me.login ? me.login : null
  } catch { return null }
}

// Prepare a review of the current checkout (the skill's preflight, as code):
// resolve the PR, verify the checkout is its open head in its base repository,
// pin the review range, collect threads and the reviewer's reviews, detect a
// follow-up and its delta, and select lenses. Every stop is `{ error }` with the
// fix; degraded collection is a warning on the run. Nothing is stored here: the
// caller writes the run. A launched run still in progress is never replaced.
export async function prepareReview(io: Io, existing: RunState | null): Promise<{ error: string } | { run: RunState }> {
  const busy = inFlightError(existing)
  if (busy) return { error: busy }

  let env: Environment
  try {
    env = await readEnvironment(io)
  } catch (e) {
    return { error: `Could not read the checkout: ${message(e)}. Run /pr-review-toolkit:review-pr from a git checkout of the PR head whose origin is on github.com.` }
  }
  const ref = await resolvePr(io, env)
  if ('error' in ref) return { error: ref.error }
  const handle = `${ref.owner}/${ref.repo}#${ref.number}`

  // get_me does not depend on the PR, so it runs beside the PR read.
  const loginRead = readLogin(io)
  let pr: PrMeta
  try {
    pr = await fetchPr(io, ref)
  } catch (e) {
    return { error: `Could not read ${handle} from GitHub: ${message(e)}` }
  }
  if (pr.headSha !== env.head) {
    return { error: `The checkout is at ${env.head}, but the head of ${handle} is ${pr.headSha || 'unknown'}. Unpushed local commits need a push first; if the PR has new commits, fetch them and check out its new head, then run /pr-review-toolkit:review-pr again.` }
  }
  if (pr.state.toLowerCase() !== 'open') return { error: `${handle} is ${pr.state || 'not open'}; only an open PR can be reviewed.` }
  // A fork clone points at the fork and would pin the wrong merge base. The PR is read
  // from origin's repository, so a mismatch here is mostly a renamed or transferred
  // repository that GitHub redirected; the fix is the same.
  const originRepo = `${ref.owner}/${ref.repo}`
  if (pr.baseRepo && pr.baseRepo.toLowerCase() !== originRepo.toLowerCase()) {
    return { error: `origin points at ${originRepo}, but the base repository of ${handle} is ${pr.baseRepo}. A fork clone, or a repository that was renamed or transferred, does this. Point origin at ${pr.baseRepo} (git remote set-url origin <its URL>) and run /pr-review-toolkit:review-pr again.` }
  }

  let pinned: PinnedRange
  try {
    pinned = await pinRange(io, env.root, pr.baseRef, pr.headSha)
  } catch (e) {
    return { error: `Could not pin the review range for ${handle}: ${message(e)}` }
  }

  const warnings: string[] = []
  if (env.dirty) warnings.push(DIRTY)
  const login = await loginRead
  if (login === null) warnings.push(NO_LOGIN)
  const reviewerLogin = login ?? ''
  // The reviewer's reviews serve follow-up only, which is off on their own PR
  // (the pre-3.0 workflow's rule), so they are read only for someone else's PR.
  const followUpLogin = reviewerLogin && reviewerLogin.toLowerCase() !== pr.author.toLowerCase() ? reviewerLogin : ''
  const [threadRead, reviewRead, selection] = await Promise.all([
    collectThreads(io, ref),
    collectReviews(io, ref, followUpLogin),
    selectLenses(io, pinned.diff),
  ])
  // A partial read (page cap, stuck cursor, a cut thread) keeps what it got.
  if (threadRead.failed) warnings.push(threadRead.threads.length ? THREADS_PARTIAL : THREADS_FAILED)
  if (reviewRead.failed) warnings.push(reviewRead.reviews.length ? REVIEWS_PARTIAL : REVIEWS_FAILED)

  const detected = detectFollowUp(threadRead.threads, reviewRead.reviews, reviewerLogin, pr.author)
  const followUp: FollowUpContext | null = detected
    ? { ...detected, delta: detected.reviewedCommit ? await computeDelta(io, env.root, detected.reviewedCommit, pr.headSha) : { available: false } }
    : null

  // The counts are git's, exact whatever the model reported; the model adds the notable areas.
  const counts = parseShortstat(pinned.diff.shortstat)
  return {
    run: {
      handle, phase: 'progress', warnings,
      pr, checkoutPath: env.root, mergeBase: pinned.mergeBase, baseAheadCount: pinned.baseAheadCount, reviewerLogin,
      diff: pinned.diff,
      summary: {
        scale: scaleOf(counts.fileCount, counts.additions + counts.deletions),
        changedFileCount: counts.fileCount, additions: counts.additions, deletions: counts.deletions,
        notableAreas: selection.shape?.notableAreas ?? [],
        shapeUnavailable: false,
      },
      lenses: selection.lenses.map((l) => ({ name: l.name, effort: l.effort, rationale: l.rationale })),
      lensSource: selection.source,
      threads: threadRead.threads, threadCollectionFailed: threadRead.failed,
      reviews: reviewRead.reviews, reviewsCollectionFailed: reviewRead.failed,
      followUp,
      deposits: {}, verdicts: null, selected: [], drafts: [], event: null, posted: [],
    },
  }
}
