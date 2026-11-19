import type { Io, McpResult } from './io'
import type { Draft, PlannedReply, PostingPlan, ReviewEvent, RunState } from './types'
import { parseDeltaHunks, SHA_RE } from './followup'
import { mcpJson } from './github'
import { replyTarget, selectedItem } from './drafting'

// Posting: the plan fixed when drafts are accepted (anchors checked against the PR
// diff, out-of-diff line drafts moved into the review body), what blocks posting, and
// the GitHub writes that post exactly that plan. Pure but for the injected Io.

type Hunks = [number, number][]
// Per path, the head-side hunks of the PR diff; null when they could not be read.
export type HunksByPath = Record<string, Hunks | null>
// finished: nothing more should be posted for this plan, because everything posted or
// because the last write's outcome is unknown (it may have posted, so it is not resent).
export type PostResult = { posted: string[]; error?: string; log: string[]; finished: boolean }

const GIT_TIMEOUT_MS = 120000
const MOVED_HEAD = 'The PR head moved since the review; re-run on the new head.'
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function inDiff(hunks: Hunks, line: number): boolean {
  return hunks.some(([a, b]) => line >= a && line <= b)
}

// One path's head-side hunks between the merge base and the reviewed head. Context is
// pinned to git's defaults (three lines, no merging of nearby hunks), whatever the
// user's diff.context or diff.interHunkContext say: GitHub's PR diff shows those lines,
// so a comment on a context line stays inline. Null when the anchors are unknown: a range
// that is not two SHAs, git failing or not running, or output the host cut short.
async function pathHunks(io: Io, run: RunState, path: string): Promise<Hunks | null> {
  if (!SHA_RE.test(run.mergeBase) || !SHA_RE.test(run.pr.headSha)) return null
  try {
    const r = await io.run([
      'git', '-c', 'core.quotePath=false', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-textconv', '--no-color',
      '--src-prefix=a/', '--dst-prefix=b/', '-U3', '--inter-hunk-context=0', `${run.mergeBase}..${run.pr.headSha}`, '--', path,
    ], { cwd: run.checkoutPath, timeoutMs: GIT_TIMEOUT_MS })
    if (r.exitCode !== 0 || r.truncated) return null
    // A file the diff does not touch has no hunks: every line is outside it.
    return parseDeltaHunks(String(r.stdout)).find((f) => f.path === path)?.hunks ?? []
  } catch {
    return null
  }
}

// The hunks of every path a line draft names, one diff per path, run together.
async function draftHunks(io: Io, run: RunState, drafts: Draft[]): Promise<HunksByPath> {
  const paths = [...new Set(drafts.filter((d) => d.kind === 'line' && d.path).map((d) => d.path!))]
  // Paths are model text: a null-prototype map cannot be confused by `__proto__`.
  const out: HunksByPath = Object.create(null)
  await Promise.all(paths.map(async (path) => { out[path] = await pathHunks(io, run, path) }))
  return out
}

// A Markdown code span around text that may itself hold backticks.
function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  return longest ? `${fence} ${text} ${fence}` : fence + text + fence
}

// The thread a reply lands on, from the covered board item it targets (the board took
// those fields from the collected thread record).
function replyThread(run: RunState, covers: string[], commentId: number): Pick<PlannedReply, 'threadPath' | 'threadLine' | 'isResolved'> {
  const out: Pick<PlannedReply, 'threadPath' | 'threadLine' | 'isResolved'> = {}
  for (const id of covers) {
    const item = selectedItem(run, id)
    if (!item || replyTarget(item) !== commentId) continue
    const t = 'ask' in item
      ? { path: item.path, line: item.line, isResolved: item.isResolved }
      : { path: item.existingReviewOverlap?.threadPath, line: item.existingReviewOverlap?.threadLine, isResolved: item.existingReviewOverlap?.isResolved }
    if (t.path) out.threadPath = t.path
    if (t.line !== undefined) out.threadLine = t.line
    if (t.isResolved !== undefined) out.isResolved = t.isResolved
    break
  }
  return out
}

// The posting plan for validated drafts: replies; line comments whose line is in the PR
// diff; and the review body, holding body drafts and every line draft whose line is
// outside the diff or whose diff could not be read (a path missing from hunksByPath
// counts as unread), in draft order. Drafts for items already posted are left out, so a
// reword after a partial post never sends them again.
export function planPosting(run: RunState, drafts: Draft[], hunksByPath: HunksByPath): PostingPlan {
  const posted = new Set(run.posted)
  const plan: PostingPlan = {
    headSha: run.pr.headSha, mergeBase: run.mergeBase,
    replies: [], lineComments: [], body: '', bodyCovers: [], moved: [], alreadyPosted: [],
  }
  const body: string[] = []
  for (const d of drafts) {
    const covers = [d.id, ...(d.alsoCovers ?? [])]
    if (covers.some((id) => posted.has(id))) { plan.alreadyPosted.push(...covers); continue }
    if (d.kind === 'reply' && d.commentId !== undefined) {
      plan.replies.push({ id: d.id, covers, commentId: d.commentId, body: d.body, ...replyThread(run, covers, d.commentId) })
      continue
    }
    if (d.kind === 'line' && d.path && d.line) {
      const hunks = Object.hasOwn(hunksByPath, d.path) ? hunksByPath[d.path] : null
      if (Array.isArray(hunks) && inDiff(hunks, d.line)) {
        plan.lineComments.push({ id: d.id, covers, path: d.path, line: d.line, body: d.body })
        continue
      }
      plan.moved.push({ id: d.id, path: d.path, line: d.line, reason: Array.isArray(hunks) ? 'outside-diff' : 'diff-unavailable' })
      body.push(`${codeSpan(`${d.path}:${d.line}`)}: ${d.body.trim()}`)
    } else {
      body.push(d.body.trim())
    }
    plan.bodyCovers.push(...covers)
  }
  plan.body = body.join('\n\n')
  return plan
}

// The plan for drafts set_drafts is about to accept: the PR diff's hunks for each line
// path, then planPosting. Never rejects; an unreadable diff moves its drafts to the body.
export async function buildPlan(io: Io, run: RunState, drafts: Draft[]): Promise<PostingPlan> {
  return planPosting(run, drafts, await draftHunks(io, run, drafts))
}

// The plan that posts nothing: Approve without comments (the pane sets it; no drafts).
export function emptyPlan(run: RunState): PostingPlan {
  return { headSha: run.pr.headSha, mergeBase: run.mergeBase, replies: [], lineComments: [], body: '', bodyCovers: [], moved: [], alreadyPosted: [] }
}

const hasReviewContent = (plan: PostingPlan): boolean => plan.lineComments.length > 0 || plan.body.trim() !== ''
const reviewCovers = (plan: PostingPlan): string[] => [...plan.lineComments.flatMap((c) => c.covers), ...plan.bodyCovers]

// The review event that posting submits, for the preview's tally too: the chosen event
// when the plan has line comments or review-body text (one is required then); with
// neither, only an approval is submitted, since a Comment or Request changes review
// needs text, so replies alone submit no review ("No review event").
export function submittedEvent(run: RunState): ReviewEvent | null {
  if (!run.plan) return null
  if (hasReviewContent(run.plan)) return run.event
  return run.event === 'APPROVE' ? 'APPROVE' : null
}

// What stops this plan from posting, whatever the phase.
function planBlockers(run: RunState): string[] {
  const plan = run.plan
  if (!plan) return ['No drafts are ready to post; draft the selected items first.']
  if (plan.headSha !== run.pr.headSha || plan.mergeBase !== run.mergeBase) return ['The drafts were checked against another head or range; draft them again.']
  const isPosted = (covers: string[]): boolean => covers.some((id) => run.posted.includes(id))
  const entries = [...plan.replies.map((r) => r.covers), ...plan.lineComments.map((c) => c.covers), ...(plan.bodyCovers.length ? [plan.bodyCovers] : [])]
  // An approval without review text carries no ids: when its replies posted but it did
  // not, it is still to post (one that went through, or may have, ends the run as 'done').
  const approvalLeft = !hasReviewContent(plan) && submittedEvent(run) === 'APPROVE'
  if (entries.length && entries.every(isPosted) && !approvalLeft) return ['Everything in this preview has been posted.']
  if (hasReviewContent(plan)) {
    if (!run.event) return ['Choose a review event: line comments and review-body text post as a review.']
    const done = reviewCovers(plan).filter((id) => run.posted.includes(id))
    if (done.length) return [`The review covers items already posted: ${done.join(', ')}; draft again.`]
    return []
  }
  const replies = plan.replies.filter((r) => !isPosted(r.covers))
  return replies.length || submittedEvent(run) ? [] : ['Nothing to post: approve without comments, or select items and draft them.']
}

// Why the post button is off (empty when posting may start). Posting starts only from
// the preview.
export function postingBlockers(run: RunState | null): string[] {
  if (!run) return ['No review is open.']
  if (run.phase === 'posting') return ['The review is being posted.']
  if (run.phase === 'done') return ['Posting finished; see the result above.']
  if (run.phase !== 'preview') return ['Posting starts from the preview.']
  return planBlockers(run)
}

// What the pane showed when the user pressed post: the plan and the event its tally named.
export type ShownPreview = { plan: PostingPlan; event: ReviewEvent | null }

// The post button's state update: claim the run for posting once (a second press finds
// it posting), clearing the last post's error. The approval is for the preview the user
// saw, so the run must still hold that plan and submit that event, compared by value. A
// blocked run is returned as it was.
export function startPosting(run: RunState | null, shown: ShownPreview): { run: RunState | null; blockers: string[] } {
  const blockers = postingBlockers(run)
  if (blockers.length || !run) return { run, blockers }
  if (JSON.stringify(run.plan) !== JSON.stringify(shown.plan) || submittedEvent(run) !== shown.event) {
    return { run, blockers: ['The preview changed; check it and post again.'] }
  }
  const { error: _lastError, ...rest } = run
  return { run: { ...rest, phase: 'posting' }, blockers }
}

// After postReview, on the run startPosting claimed (`claimed`). Another run (another
// launch nonce or task, PR or head) is returned unchanged. On the same run, what posted
// is always recorded, whatever its phase or plan now (a plan replaced or dropped while
// posting must not lose it, or a later post would send it again): never duplicated, and
// it leaves the selection, so a reword after a partial post drafts only what is still to
// post (a merged draft can never tie a posted id to an unposted one and be dropped with
// it). A run still posting goes to 'done' when finished, else back to the preview with
// the error.
export function finishPosting(run: RunState | null, claimed: RunState, out: PostResult): RunState | null {
  if (!run || run.run !== claimed.run || run.taskId !== claimed.taskId) return run
  if (run.handle !== claimed.handle || run.pr.headSha !== claimed.pr.headSha) return run
  const posted = [...run.posted, ...out.posted.filter((id, i) => !run.posted.includes(id) && out.posted.indexOf(id) === i)]
  const selected = run.selected.filter((id) => !out.posted.includes(id))
  if (run.phase !== 'posting') return { ...run, posted, selected }
  const { error: _lastError, ...rest } = run
  return { ...rest, posted, selected, phase: out.finished ? 'done' : 'preview', ...(out.error ? { error: out.error } : {}) }
}

// A 4xx refusal in an error text: GitHub validated the request and turned it down. URLs
// are dropped first, so a PR number or repository name in the request URL cannot match.
const REFUSAL_RE = /\b(?:422|404|403)\b|validation failed|unprocessable|not found|forbidden/i
export function isRefusal(text: string): boolean {
  return REFUSAL_RE.test(text.replace(/https?:\/\/\S+/gi, ''))
}

// One GitHub write: ok; refused (nothing happened); or uncertain (it may have happened).
// GitHub's MCP server reports HTTP timeouts, connection resets and 5xx answers, some
// given after GitHub acted, as isError results like any refusal, so an isError counts
// as refused only when its text shows a 4xx refusal; any other, and a call that threw,
// is uncertain.
type Write = { ok: true } | { ok: false; refused: boolean; why: string }
async function write(io: Io, tool: string, args: Record<string, unknown>): Promise<Write> {
  let r: McpResult
  try { r = await io.mcp(tool, args) } catch (e) { return { ok: false, refused: false, why: message(e) } }
  if (!r?.isError) return { ok: true }
  const why = r.content?.find((c) => typeof c?.text === 'string')?.text || `${tool} failed`
  return { ok: false, refused: isRefusal(why), why }
}

const ids = (covers: string[]): string => covers.join(', ')
const thread = (r: PlannedReply): string => (r.threadPath ? `the thread on ${r.threadPath}${r.threadLine ? `:${r.threadLine}` : ''}` : `comment ${r.commentId}`)

// Post run.plan exactly: re-read the PR and stop if its head moved; post the replies,
// then the review (a pending review, its line comments, then submit with the event and
// body; or, with no line comments, one create with the event). Ids already in run.posted
// are skipped. A failed reply stops before any review exists; a failed line comment or
// submit deletes the pending review. A failed create deletes nothing: GitHub refuses a
// second pending review, and the one it refused over may be the user's own. A write that
// may have happened (see write) counts as posted, so it is never sent twice. `posted`
// names the ids this call posted (each entry's id and alsoCovers); the error names what
// posted. Never throws.
export async function postReview(io: Io, run: RunState): Promise<PostResult> {
  const log: string[] = []
  const posted: string[] = []
  const repliesPosted: PlannedReply[] = []
  const blocked = planBlockers(run)
  if (blocked.length || !run.plan) return { posted, error: blocked[0] ?? 'Nothing to post.', log, finished: false }
  const plan = run.plan
  const where = { owner: run.pr.owner, repo: run.pr.repo, pullNumber: run.pr.number }
  const head = run.pr.headSha

  const sofar = (): string => repliesPosted.length
    ? `Posted before the stop: the ${repliesPosted.length === 1 ? 'reply' : 'replies'} for ${repliesPosted.map((r) => ids(r.covers)).join('; ')}.`
    : 'Nothing was posted.'
  const stop = (error: string, finished = false): PostResult => { log.push(error); return { posted, error, log, finished } }

  let current: unknown
  try {
    const pr = await mcpJson(io, 'pull_request_read', { method: 'get', ...where })
    current = pr?.head?.sha
    if (typeof current !== 'string' || !current) throw new Error('the PR has no head commit')
  } catch (e) {
    return stop(`Could not re-read ${run.handle} before posting: ${message(e)}. Nothing was posted.`)
  }
  if (current !== head) return stop(MOVED_HEAD)
  log.push(`${run.handle} is still at ${head.slice(0, 7)}.`)

  for (const reply of plan.replies) {
    if (reply.covers.some((id) => run.posted.includes(id))) { log.push(`Skipped the reply for ${ids(reply.covers)}: already posted.`); continue }
    const w = await write(io, 'add_reply_to_pull_request_comment', { ...where, commentId: reply.commentId, body: reply.body })
    if (w.ok) {
      posted.push(...reply.covers)
      repliesPosted.push(reply)
      log.push(`Replied on ${thread(reply)} for ${ids(reply.covers)}.`)
      continue
    }
    if (!w.refused) {
      // It may have posted: it counts as posted, so it is never sent twice.
      const before = sofar()
      posted.push(...reply.covers)
      return stop(`Posting stopped: GitHub did not confirm the reply for ${ids(reply.covers)} on ${thread(reply)} (${w.why}). It may have posted; check that thread. It will not be sent again. ${before} No review was submitted.`)
    }
    return stop(`Posting stopped: the reply for ${ids(reply.covers)} on ${thread(reply)} failed: ${w.why}. ${sofar()} No review was submitted.`)
  }

  const event = submittedEvent(run)
  const covers = reviewCovers(plan)
  const body = plan.body.trim()

  // Deletes the pending review this call created; says how that went.
  const abandon = async (): Promise<{ deleted: boolean; note: string }> => {
    const d = await write(io, 'pull_request_review_write', { method: 'delete_pending', ...where })
    if (d.ok) { log.push('Deleted the pending review.'); return { deleted: true, note: 'The pending review was deleted.' } }
    log.push(`Could not delete the pending review: ${d.why}.`)
    return { deleted: false, note: `The pending review could not be deleted (${d.why}); delete it on GitHub.` }
  }

  if (plan.lineComments.length) {
    const created = await write(io, 'pull_request_review_write', { method: 'create', ...where, commitID: head })
    if (!created.ok) {
      return stop(`Posting stopped: creating the pending review failed: ${created.why}. ${sofar()} No review was submitted; if GitHub shows a pending review of yours on this PR, submit or delete it there before posting again.`)
    }
    log.push(`Started a pending review on ${head.slice(0, 7)}.`)
    for (const c of plan.lineComments) {
      const added = await write(io, 'add_comment_to_pending_review', { ...where, path: c.path, line: c.line, side: 'RIGHT', subjectType: 'LINE', body: c.body })
      if (!added.ok) {
        // A line comment only stages: whatever happened, deleting the pending review takes it back.
        const { note } = await abandon()
        // A GraphQL out-of-diff error names no status code, so the hint goes with either.
        const what = added.refused
          ? `GitHub refused the line comment for ${c.id} on ${c.path}:${c.line}: ${added.why}.`
          : `GitHub did not confirm the line comment for ${c.id} on ${c.path}:${c.line} (${added.why}).`
        const hint = `If that line is not part of the PR diff on GitHub (a renamed file can make it look like it is here), ask Claude to draft ${c.id} as a review-body comment.`
        return stop(`Posting stopped: ${what} ${hint} ${note} ${sofar()} No review was submitted.`)
      }
      log.push(`Added the line comment for ${ids(c.covers)} on ${c.path}:${c.line}.`)
    }
    const submitted = await write(io, 'pull_request_review_write', { method: 'submit_pending', ...where, event, ...(body ? { body } : {}) })
    if (!submitted.ok) {
      // A pending review still there to delete was not submitted. One that cannot be
      // deleted may be gone because the submit went through (even a refusal can follow
      // a submit that landed), so the review then counts as possibly submitted.
      const { deleted, note } = await abandon()
      if (!deleted) {
        posted.push(...covers)
        return stop(`Posting stopped: submitting the review failed (${submitted.why}) and the pending review could not be deleted, so the review may have been submitted; check the PR. It will not be sent again. ${sofar()}`, true)
      }
      return stop(`Posting stopped: submitting the review failed: ${submitted.why}. ${note} ${sofar()} No review was submitted.`)
    }
  } else if (event) {
    const created = await write(io, 'pull_request_review_write', { method: 'create', ...where, event, ...(body ? { body } : {}), commitID: head })
    if (!created.ok) {
      if (!created.refused) {
        posted.push(...covers)
        return stop(`Posting stopped: GitHub did not confirm the review submission (${created.why}), so the review may have been submitted; check the PR. It will not be sent again. ${sofar()}`, true)
      }
      return stop(`Posting stopped: GitHub refused the review: ${created.why}. ${sofar()} No review was submitted.`)
    }
  } else {
    log.push('No review submitted: replies only.')
    return { posted, log, finished: true }
  }
  posted.push(...covers)
  const parts = [
    plan.lineComments.length ? `${plan.lineComments.length} line comment${plan.lineComments.length === 1 ? '' : 's'}` : '',
    body ? 'a review body' : '',
  ].filter(Boolean)
  log.push(`Submitted the review (${event})${parts.length ? ' with ' + parts.join(' and ') : ''}.`)
  return { posted, log, finished: true }
}
