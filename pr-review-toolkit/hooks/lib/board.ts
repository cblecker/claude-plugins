import type {
  Board, BoardItem, BoardSection, ChangeSummary, Delta, Finding, FollowUpBoard, FollowUpContext, FollowUpItem,
  LensSelection, Location, ReviewOverlap, RunState, Thread, Verdict,
} from './types'

// The review board: a port of the pre-3.0 review-pr workflow's routing and
// finalizeBoard, as pure functions over the run. The workflow's module globals
// (the follow-up delta, whether the reviewer opened the PR) are parameters.

export const BOARD_SECTIONS: readonly BoardSection[] = ['recommendedToPost', 'discussionOnly', 'alreadyCovered', 'discarded']

// The synthesizer's decisions, by index into its input findings (see synthesis.ts).
export type SynthesisGroup = {
  findings: number[]; section: string
  overlap?: { status: string; threadId?: string; rationale?: string }
  title?: string; claim?: string; note?: string
}
export type Synthesized = { groups: SynthesisGroup[]; keepPositives?: number[] }

export type BoardContext = {
  threads: Thread[]; threadCollectionFailed: boolean; reviewsCollectionFailed: boolean; synthesisFailed: boolean
  followUp: FollowUpBoard | null; followUpDelta: Delta | null; summary: ChangeSummary
  selectedReviewers: string[]; lensEffort: Record<string, string>; failedReviewers: string[]; lensSelection: LensSelection
  reviewerIsAuthor: boolean
  // The run's prepare-time warnings (run.warnings), printed first; and how many of the
  // reviewer's reviews were read, so a partial read is not reported as a failed one.
  warnings?: string[]; reviewCount?: number
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, important: 1, suggestion: 2 }
export function compareFindings(a: { severity?: string; confidence?: number }, b: { severity?: string; confidence?: number }): number {
  const sevDiff = (SEVERITY_ORDER[a.severity ?? ''] ?? 3) - (SEVERITY_ORDER[b.severity ?? ''] ?? 3)
  if (sevDiff !== 0) return sevDiff
  return (b.confidence || 0) - (a.confidence || 0)
}

export function sortFindings<T extends { severity?: string; confidence?: number }>(arr: T[]): void {
  arr.sort(compareFindings)
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function uniq(values: (string | undefined | null)[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  ;(values || []).forEach((value) => {
    if (!value || seen.has(value)) return
    seen.add(value)
    out.push(value)
  })
  return out
}

// Resolution state is tri-state: true, false, or undefined when the GitHub
// read tools did not expose it. Coercing unknown to false would hide the
// uncertainty from the posting preview.
export function knownResolved(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

type Group = { members: number[]; section?: string; overlap?: SynthesisGroup['overlap']; title?: string; claim?: string; note?: string }
// While the board is built an overlap still names its thread; the id is dropped once
// it has served the follow-up cross-reference.
type Overlap = ReviewOverlap & { threadId?: string }
type Item = Omit<BoardItem, 'id' | 'existingReviewOverlap'> & { id?: string; existingReviewOverlap?: Overlap }

// Every finding index lands in exactly one group, the first that claims it;
// indexes the synthesizer dropped (or every index, when synthesis failed)
// become groups of one, routed on their own severity and confidence.
function synthesisGroups(synthesized: Synthesized | null, findingCount: number): Group[] {
  const claimed = new Set<number>()
  const claim = (index: unknown): index is number => {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= findingCount || claimed.has(index)) return false
    claimed.add(index)
    return true
  }
  const groups: Group[] = []
  const raw = synthesized && Array.isArray(synthesized.groups) ? synthesized.groups : []
  raw.forEach((group) => {
    if (!group || !Array.isArray(group.findings)) return
    const members = group.findings.filter((index) => claim(index))
    if (members.length === 0) return
    // Rewritten text is accepted only where it merges several findings; a
    // lone finding keeps the specialist's own words.
    const merged = members.length > 1
    groups.push({
      members,
      section: group.section,
      overlap: group.overlap,
      title: merged ? group.title : undefined,
      claim: merged ? group.claim : undefined,
      note: group.note,
    })
  })
  for (let index = 0; index < findingCount; index++) {
    if (claim(index)) groups.push({ members: [index] })
  }
  return groups
}

// Thread identity comes only from the collector's record for the thread id
// the synthesizer named, so commentId, isResolved, and the descriptors always
// describe one real thread. An 'overlaps' id that matches no thread keeps the
// status but carries no reply target, which the posting preview flags;
// 'already_covered' hides the finding, so it needs a real thread.
function reviewOverlap(overlap: SynthesisGroup['overlap'], threads: Thread[]): Overlap | undefined {
  if (!overlap || (overlap.status !== 'overlaps' && overlap.status !== 'already_covered')) return undefined
  const thread = overlap.threadId ? threads.find((t) => t && t.id === overlap.threadId) : null
  if (overlap.status === 'already_covered' && !thread) return undefined
  const result: Overlap = { status: overlap.status }
  if (thread) {
    Object.assign(result, {
      threadId: thread.id,
      commentId: thread.commentId || undefined,
      isResolved: knownResolved(thread.isResolved),
      threadAuthor: thread.author || undefined,
      threadPath: thread.path || undefined,
      threadLine: thread.line != null ? thread.line : thread.originalLine,
    })
  }
  if (overlap.rationale) result.rationale = overlap.rationale
  return result
}

function joinDistinct(values: unknown[]): string {
  const parts: string[] = []
  values.forEach((value) => {
    const text = String(value || '').trim()
    if (text && !parts.some((existing) => existing.indexOf(text) !== -1)) parts.push(text)
  })
  return parts.join('\n\n')
}

// The most severe, most confident member leads; the others add their
// distinct evidence and fixes. Empty fields are omitted, not filled.
function boardItem(group: Group, findings: Finding[], threads: Thread[]): Item {
  const members = group.members.map((index) => findings[index]!)
  const lead = members.slice().sort(compareFindings)[0]!
  const item: Item = {
    lens: uniq([lead.lens].concat(members.map((finding) => finding.lens))).join(', '),
    title: group.title || lead.title,
    severity: lead.severity,
    confidence: asNumber(lead.confidence, 0),
    location: lead.location,
    claim: group.claim || lead.claim,
    evidence: joinDistinct(members.map((finding) => finding.evidence)),
    whyItMatters: joinDistinct(members.map((finding) => finding.whyItMatters)),
    suggestedFix: joinDistinct(members.map((finding) => finding.suggestedFix)),
  }
  const fields = item as Record<string, unknown>
  Object.keys(fields).forEach((key) => {
    if (fields[key] === '' || fields[key] == null) delete fields[key]
  })
  const overlap = reviewOverlap(group.overlap, threads)
  if (overlap) item.existingReviewOverlap = overlap
  if (group.note) item.routingNote = group.note
  return item
}

function baseSection(item: Item, preferredSection: string | undefined): BoardSection {
  const overlap: Partial<Overlap> = item.existingReviewOverlap || {}
  if (preferredSection === 'discarded') return 'discarded'
  if (overlap.status === 'already_covered') return 'alreadyCovered'
  // An 'overlaps' status stays on the item as an annotation; the finding is
  // routed on its own merit and posts as a thread reply when selected. A
  // preferred alreadyCovered without a verified thread routes on merit too.
  if (preferredSection !== 'alreadyCovered' && (BOARD_SECTIONS as readonly string[]).indexOf(preferredSection ?? '') !== -1) return preferredSection as BoardSection
  if (asNumber(item.confidence, 0) < 50) return 'discarded'
  if ((item.severity === 'critical' || item.severity === 'important') && asNumber(item.confidence, 0) >= 80) return 'recommendedToPost'
  return 'discussionOnly'
}

// Whether a finding's location changed since the reviewer's last review, from
// the follow-up delta: its line falls in a changed hunk, or, without a line,
// its file changed. Undefined when the delta is unknown or the finding is
// PR-wide, so routing never demotes on a guess. Computed after grouping, so
// merged findings need no combining rule.
function changedSinceReview(location: Location | undefined, delta: Delta | null): boolean | undefined {
  if (!delta || !delta.available || !location || !location.path || location.path === 'PR') return undefined
  const file = (delta.files || []).find((entry) => entry && entry.path === location.path)
  if (!file) return false
  const line = location.line
  if (line == null || !Array.isArray(file.hunks) || file.hunks.length === 0) return true
  return file.hunks.some((hunk) => Array.isArray(hunk) && line >= hunk[0] && line <= hunk[1])
}

// Follow-up demotion: code unchanged since the reviewer's own last review was
// already reviewed once, so a non-critical finding there is not re-recommended.
// It is demoted, not dropped, with the reason on the item — the user can
// promote it back from the board.
function routeSection(item: Item, preferredSection: string | undefined, followUp: FollowUpBoard | null, memberLocations: (Location | undefined)[], followUpDelta: Delta | null): BoardSection {
  if (followUp) {
    // A merged concern is changed when any member's location is, unchanged
    // only when every member's is, and otherwise unknown.
    const states = (memberLocations && memberLocations.length ? memberLocations : [item.location])
      .map((location) => changedSinceReview(location, followUpDelta))
    const changed = states.includes(true) ? true : states.every((state) => state === false) ? false : undefined
    if (changed !== undefined) item.changedSinceLastReview = changed
  }
  const section = baseSection(item, preferredSection)
  if (section !== 'recommendedToPost') return section
  if (followUp && item.changedSinceLastReview === false && item.severity !== 'critical') {
    item.routingNote = 'Code unchanged since your review at ' + followUp.reviewedCommit.slice(0, 7) + '.'
    return 'discussionOnly'
  }
  return section
}

function followUpItemForThread(followUp: FollowUpBoard | null, threadId: string | undefined): FollowUpItem | null {
  if (!followUp || !threadId) return null
  return followUp.items.find((item) => item && item.threadId === threadId) || null
}

// Not-posting sections render as one-liners, so their items carry no long
// text; the claim stays so a promoted finding can still be drafted.
const NOT_POSTING_FIELDS = ['id', 'lens', 'title', 'severity', 'confidence', 'location', 'claim', 'existingReviewOverlap', 'followUpItemId', 'routingNote'] as const

function compactItem(item: BoardItem): BoardItem {
  const compact: Record<string, unknown> = {}
  NOT_POSTING_FIELDS.forEach((key) => {
    if (item[key] !== undefined) compact[key] = item[key]
  })
  return compact as BoardItem
}

// Synthesis keeps positive observations by index into its input; invalid or
// repeated indexes are dropped. Without a synthesis result every distinct
// observation is kept.
function keptPositives(synthesized: Synthesized | null, positives: string[]): string[] {
  if (!synthesized || !Array.isArray(synthesized.keepPositives)) return uniq(positives)
  return uniq(synthesized.keepPositives
    .filter((index) => Number.isInteger(index) && index >= 0 && index < positives.length)
    .map((index) => positives[index]))
}

// Degradation warnings are finished sentences, so the board prints each one
// whenever its flag is set instead of relying on the model to notice it. The
// flags stay in reviewMeta and followUp for the menus that branch on them.
// A partial thread or review read keeps what it got and says so in the run's
// own warnings; the "could not be collected" sentences are for a read that got
// nothing.
function reviewWarnings(context: BoardContext): string[] {
  const warnings: string[] = []
  if (context.lensSelection && context.lensSelection.source === 'all-lenses-fallback') {
    warnings.push('The lens selector returned invalid output, so every lens ran.')
  }
  if (context.failedReviewers && context.failedReviewers.length) {
    warnings.push(context.failedReviewers.join(', ') + ' did not complete, so the board is missing that coverage and the review is narrower than the reviewer list suggests.')
  }
  if (context.threadCollectionFailed && !(context.threads && context.threads.length)) {
    warnings.push('Existing review threads could not be collected, so overlap classification and verdicts on your earlier threads are unavailable, and recommended findings may duplicate existing comments.')
  }
  if (context.synthesisFailed) {
    warnings.push('The synthesis step did not complete, so duplicate findings from different lenses are listed separately, overlap with existing threads was not checked, and sections come from severity and confidence alone.')
  }
  if (context.reviewsCollectionFailed && !context.reviewCount) {
    warnings.push('Your submitted reviews could not be read, so asks made only in a review summary are not checked.')
  }
  if (context.reviewerIsAuthor) {
    warnings.push('You opened this PR, so your own threads and comments are author notes and follow-up mode is off.')
  }
  const followUp = context.followUp
  if (followUp && followUp.verifierFailed) {
    warnings.push('The follow-up verifier did not complete, so every thread is unverifiable and review-summary asks were not checked.')
  } else if (followUp && followUp.reviewedCommit && !followUp.deltaAvailable) {
    warnings.push('What changed since your review could not be determined (usually because the branch was rewritten), so follow-up verdicts rest on the current code only.')
  }
  return warnings
}

// Route every group, then number the items F1.. once, in section order after
// sorting: every later action keys on these ids. Board warnings are the run's
// prepare-time warnings followed by the flag-derived ones, each said once.
export function finalizeBoard(synthesized: Synthesized | null, findings: Finding[], positives: string[], context: BoardContext): Board {
  const sections: Record<BoardSection, Item[]> = { recommendedToPost: [], discussionOnly: [], alreadyCovered: [], discarded: [] }
  synthesisGroups(synthesized, findings.length).forEach((group) => {
    const item = boardItem(group, findings, context.threads)
    const memberLocations = group.members.map((index) => findings[index] && findings[index]!.location)
    sections[routeSection(item, group.section, context.followUp, memberLocations, context.followUpDelta)].push(item)
  })

  let nextId = 1
  const numberedSections = {} as Record<BoardSection, BoardItem[]>
  BOARD_SECTIONS.forEach((section) => {
    sortFindings(sections[section])
    numberedSections[section] = sections[section].map((item) => {
      const numbered: Item & { id: string } = Object.assign({ id: 'F' + nextId++ }, item)
      // A finding that overlaps one of the reviewer's own threads is a
      // follow-up on that thread; the board cross-references it by P id.
      const overlap = numbered.existingReviewOverlap
      const followUpItem = followUpItemForThread(context.followUp, overlap && overlap.threadId)
      if (followUpItem) numbered.followUpItemId = followUpItem.id
      // The thread id served only this cross-reference; reply targets use
      // commentId.
      if (overlap) {
        const { threadId: _threadId, ...rest } = overlap
        numbered.existingReviewOverlap = rest
      }
      // A routing note explains why a finding is not recommended.
      if (section === 'recommendedToPost') delete numbered.routingNote
      return section === 'alreadyCovered' || section === 'discarded' ? compactItem(numbered) : numbered
    })
  })

  return {
    ...numberedSections,
    positiveObservations: keptPositives(synthesized, positives),
    summary: context.summary,
    followUp: context.followUp || null,
    reviewMeta: {
      warnings: uniq([...(context.warnings || []), ...reviewWarnings(context)]),
      reviewerIsAuthor: !!context.reviewerIsAuthor,
      selectedReviewers: context.selectedReviewers,
      lensEffort: context.lensEffort,
      failedReviewers: context.failedReviewers,
      lensSelection: context.lensSelection,
      threadCollectionFailed: !!context.threadCollectionFailed,
      reviewsCollectionFailed: !!context.reviewsCollectionFailed,
      synthesisFailed: !!context.synthesisFailed,
    },
  }
}

// The follow-up items, one per earlier ask: a port of the workflow's
// applyFollowUpVerdict without the delta (the run carries it). Thread items
// follow the reviewer's threads in order, so their P ids are stable whatever
// the verifier returned, and thread identity and state come from the
// collector record; only the verdict comes from the verifier. Summary asks
// follow, as the verifier returned them. No verdicts at all means the
// verifier failed.
export function followUpItems(followUp: { verifierFailed?: boolean }, threads: Thread[], verdicts: Verdict[] | null): FollowUpItem[] {
  const verifierFailed = !!followUp.verifierFailed || !Array.isArray(verdicts)
  const byThread = new Map<string, Verdict>()
  const summaryItems: Verdict[] = []
  if (Array.isArray(verdicts)) {
    verdicts.forEach((item) => {
      if (!item) return
      if (item.threadId) byThread.set(item.threadId, item)
      else summaryItems.push(item)
    })
  }
  const verdictFields = (item: Verdict | undefined, sourceText: string): Verdict => ({
    ask: item && item.ask ? item.ask : String(sourceText || '').split('\n')[0]!.slice(0, 160),
    status: item && item.status ? item.status : 'unverifiable',
    evidence: item && item.evidence
      ? item.evidence
      : (verifierFailed ? 'The follow-up verifier did not complete.' : 'The verifier returned no verdict for this thread.'),
    fixedIn: item && item.fixedIn ? item.fixedIn : undefined,
  })
  const threadItems: Omit<FollowUpItem, 'id'>[] = threads.map((thread) => Object.assign({
    threadId: thread.id,
    commentId: thread.commentId || undefined,
    path: thread.path,
    line: thread.line != null ? thread.line : thread.originalLine,
    isResolved: knownResolved(thread.isResolved),
    isOutdated: knownResolved(thread.isOutdated),
  }, verdictFields(byThread.get(thread.id), thread.body)))
  return threadItems
    .concat(summaryItems.map((item) => verdictFields(item, '')))
    .map((item, index) => Object.assign({ id: 'P' + (index + 1) }, item))
}

// Only a delta that could actually be computed: there must be a reviewed
// commit to diff from, and a missing file list would read as "nothing changed".
export function followUpDeltaOf(followUp: FollowUpContext | null): Delta | null {
  return followUp && followUp.reviewedCommit && followUp.delta && followUp.delta.available === true && Array.isArray(followUp.delta.files)
    ? followUp.delta
    : null
}

// The board's follow-up section for a run in follow-up mode.
export function followUpBoard(followUp: FollowUpContext, verdicts: Verdict[] | null, verifierFailed: boolean): FollowUpBoard {
  const delta = followUpDeltaOf(followUp)
  const failed = verifierFailed || !Array.isArray(verdicts)
  return {
    reviewedCommit: followUp.reviewedCommit,
    reviewedAt: followUp.reviewedAt,
    reviewState: followUp.reviewState,
    threadCount: followUp.threads.length,
    deltaAvailable: Boolean(delta),
    commitsSince: delta ? delta.commitsSince : undefined,
    verifierFailed: failed,
    items: followUpItems({ verifierFailed: failed }, followUp.threads, verdicts),
  }
}

// The board for a finished run (its lens outcome already recorded by withOutcome)
// from the synthesis result. A run with findings and no synthesis lists them unmerged.
export function buildBoard(run: RunState, out: { synthesized: Synthesized | null; findings: Finding[]; positives: string[] }): Board {
  const login = run.reviewerLogin || ''
  return finalizeBoard(out.synthesized, out.findings, out.positives, {
    threads: run.threads,
    threadCollectionFailed: run.threadCollectionFailed,
    reviewsCollectionFailed: run.reviewsCollectionFailed,
    synthesisFailed: out.findings.length > 0 && !out.synthesized,
    followUp: run.followUp ? followUpBoard(run.followUp, run.verdicts, !!run.verifierFailed) : null,
    followUpDelta: followUpDeltaOf(run.followUp),
    summary: run.summary,
    selectedReviewers: run.lenses.map((l) => l.name),
    lensEffort: Object.fromEntries(run.lenses.map((l) => [l.name, l.effort])),
    failedReviewers: run.failedLenses || [],
    // Rationales only where the selector gave one (the all-lenses fallback gives none).
    lensSelection: { source: run.lensSource, rationales: Object.fromEntries(run.lenses.filter((l) => l.rationale).map((l) => [l.name, l.rationale])) },
    // On the reviewer's own PR their threads and comments are author notes.
    reviewerIsAuthor: login !== '' && login.toLowerCase() === String(run.pr.author || '').toLowerCase(),
    warnings: run.warnings,
    reviewCount: (run.reviews || []).length,
  })
}

// Board edits from the pane. Each returns a new board (the given one when
// nothing moves); ids never change.
export function findItem(b: Board, id: string): { section: BoardSection; index: number } | null {
  for (const s of BOARD_SECTIONS) { const i = b[s].findIndex((x) => x.id === id); if (i >= 0) return { section: s, index: i } }
  return null
}

function move(b: Board, id: string, to: BoardSection, note?: string): Board {
  const at = findItem(b, id); if (!at || at.section === to) return b
  const next: Board = { ...b, recommendedToPost: [...b.recommendedToPost], discussionOnly: [...b.discussionOnly], alreadyCovered: [...b.alreadyCovered], discarded: [...b.discarded] }
  const [item] = next[at.section].splice(at.index, 1)
  if (!item) return b
  // A routing note explains why a finding is not recommended, so none goes into Recommended.
  const { routingNote: _note, ...rest } = item
  next[to].push(to === 'recommendedToPost' ? rest : note ? { ...item, routingNote: note } : item)
  return next
}

export const promote = (b: Board, id: string): Board => move(b, id, 'recommendedToPost')
export const demote = (b: Board, id: string): Board => move(b, id, 'discussionOnly')

// "Too picky": every recommended finding that is not critical and not changed
// since the reviewer's last review moves to Other findings.
export function tooPicky(b: Board): Board {
  return b.recommendedToPost.filter((i) => i.severity !== 'critical' && i.changedSinceLastReview !== true)
    .reduce((acc, i) => move(acc, i.id, 'discussionOnly', 'Demoted at your request.'), b)
}
