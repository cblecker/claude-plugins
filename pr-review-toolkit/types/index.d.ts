export type Severity = 'critical' | 'important' | 'suggestion'
export type Location = { path: string; line?: number }
export type Finding = { location: Location; severity: Severity; confidence: number; title: string; claim: string; evidence: string; whyItMatters: string; suggestedFix?: string; lens?: string }
export type Reply = { author: string; body: string }
export type Thread = { id: string; commentId?: number; path: string; line?: number; originalLine?: number; author: string; body: string; isResolved?: boolean; isOutdated?: boolean; replies: Reply[] }
export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
export type Review = { author: string; state: ReviewState; commitId?: string; submittedAt?: string; body: string }
export type Delta = { available: boolean; commitsSince?: number; files?: { path: string; hunks: [number, number][] }[] }
export type ReviewSummary = { state: string; submittedAt: string; body: string }
export type FollowUpContext = { reviewedCommit: string; reviewedAt: string; reviewState: string; threads: Thread[]; reviewSummaries: ReviewSummary[]; delta: Delta }
export type VerdictStatus = 'addressed' | 'partial' | 'not_addressed' | 'unverifiable'
export type Verdict = { threadId?: string; ask: string; status: VerdictStatus; evidence: string; fixedIn?: string }
export type FollowUpItem = Verdict & { id: string; commentId?: number; path?: string; line?: number; isResolved?: boolean; isOutdated?: boolean }
export type Deposit = { findings: Finding[]; positiveObservations: string[] }
// One drafted comment, for the item `id` (F or P). alsoCovers names other selected items the
// same comment speaks for (a finding and the follow-up item on its thread share one reply);
// reply and body drafts only. Every selected id is covered exactly once, as an id or in alsoCovers.
export type Draft = { id: string; kind: 'line' | 'reply' | 'body'; path?: string; line?: number; commentId?: number; body: string; alsoCovers?: string[] }
export type ReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'
// The posting plan, fixed when drafts are accepted: the preview shows it and posting sends
// exactly it. Each entry posts for `covers` (its draft's id, then the draft's alsoCovers).
// A reply's thread fields come from the board item it targets; isResolved absent = unknown.
export type PlannedReply = { id: string; covers: string[]; commentId: number; body: string; threadPath?: string; threadLine?: number; isResolved?: boolean }
export type PlannedLineComment = { id: string; covers: string[]; path: string; line: number; body: string }
// A line draft posted in the review body instead: its line is outside the PR diff, or the
// diff could not be read, so the anchor is unknown.
export type MovedDraft = { id: string; path: string; line: number; reason: 'outside-diff' | 'diff-unavailable' }
// headSha/mergeBase: the range the anchors were checked against. body: the review body as it
// posts (body drafts and moved line drafts, in draft order); bodyCovers: the ids it posts for.
// alreadyPosted: ids whose drafts were left out because they had posted already.
export type PostingPlan = {
  headSha: string; mergeBase: string
  replies: PlannedReply[]; lineComments: PlannedLineComment[]
  body: string; bodyCovers: string[]; moved: MovedDraft[]; alreadyPosted: string[]
}
export type Phase = 'progress' | 'board' | 'drafting' | 'preview' | 'posting' | 'done' | 'failed'
// The PR's shape: counts from git, notable areas from the lens selector.
export type ChangeSummary = { scale: string; changedFileCount?: number; additions?: number; deletions?: number; notableAreas: string[]; shapeUnavailable: boolean }
// An existing review thread a board item matches. The thread's identity comes from the
// collected thread record, never from the model: commentId is the reply target.
export type ReviewOverlap = { status: 'overlaps' | 'already_covered'; commentId?: number; isResolved?: boolean; threadAuthor?: string; threadPath?: string; threadLine?: number; rationale?: string }
// A board item: one finding, or several merged into one concern. alreadyCovered and
// discarded items keep only id, lens, title, severity, confidence, location, claim,
// existingReviewOverlap, followUpItemId and routingNote.
export type BoardItem = {
  id: string; lens?: string; title: string; severity: Severity; confidence: number; location?: Location
  claim?: string; evidence?: string; whyItMatters?: string; suggestedFix?: string
  existingReviewOverlap?: ReviewOverlap; followUpItemId?: string; routingNote?: string; changedSinceLastReview?: boolean
}
export type BoardSection = 'recommendedToPost' | 'discussionOnly' | 'alreadyCovered' | 'discarded'
// The follow-up section: the reviewer's last review, what changed since, and a verdict
// on each earlier ask (P ids).
export type FollowUpBoard = {
  reviewedCommit: string; reviewedAt: string; reviewState: string; threadCount: number
  deltaAvailable: boolean; commitsSince?: number; verifierFailed: boolean; items: FollowUpItem[]
}
export type LensSelection = { source: 'selector' | 'all-lenses-fallback'; rationales: Record<string, string> }
// warnings are finished sentences, each printed whenever present; the flags stay for
// the choices that branch on them.
export type ReviewMeta = {
  warnings: string[]; reviewerIsAuthor: boolean; selectedReviewers: string[]; lensEffort: Record<string, string>
  failedReviewers: string[]; lensSelection: LensSelection
  threadCollectionFailed: boolean; reviewsCollectionFailed: boolean; synthesisFailed: boolean
}
export type Board = {
  recommendedToPost: BoardItem[]; discussionOnly: BoardItem[]; alreadyCovered: BoardItem[]; discarded: BoardItem[]
  positiveObservations: string[]; summary: ChangeSummary; followUp: FollowUpBoard | null; reviewMeta: ReviewMeta
}
// baseRepo is the base repository's `owner/repo` as GitHub names it (`base.repo.full_name`),
// absent when the response does not say; prepare_review checks it against origin.
export type PrMeta = { owner: string; repo: string; number: number; title: string; body: string; author: string; state: string; baseRef: string; headSha: string; mergeableState?: string; baseRepo?: string }
export type RunState = {
  handle: string; phase: Phase; error?: string; warnings: string[]
  pr: PrMeta; checkoutPath: string; mergeBase: string; baseAheadCount: number; reviewerLogin: string
  diff: { nameStatus: string; numstat: string; shortstat: string }
  summary: ChangeSummary
  lenses: { name: string; effort: string; rationale: string }[]; lensSource: 'selector' | 'all-lenses-fallback'
  threads: Thread[]; threadCollectionFailed: boolean; reviews: Review[]; reviewsCollectionFailed: boolean
  followUp: FollowUpContext | null
  run?: string; taskId?: string
  // synthesizing: the workflow finished and the mod is building the board (phase stays 'progress').
  // failedLenses / verifierFailed: lensOutcome at finish, for the board's warnings.
  synthesizing?: boolean; failedLenses?: string[]; verifierFailed?: boolean
  deposits: Record<string, Deposit>; verdicts: Verdict[] | null
  board?: Board; selected: string[]; drafts: Draft[]; event: ReviewEvent | null; posted: string[]
  // plan: what posts, fixed with the drafts. error in 'preview' or 'done': the last post's failure.
  plan?: PostingPlan
}

declare module 'claude-code' {
  interface PluginState {
    'pr-review-toolkit': { run: RunState | null }
  }
}
