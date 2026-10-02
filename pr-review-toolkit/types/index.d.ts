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
export type Draft = { id: string; kind: 'line' | 'reply' | 'body'; path?: string; line?: number; commentId?: number; body: string }
export type ReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'
export type Phase = 'progress' | 'board' | 'drafting' | 'preview' | 'posting' | 'done' | 'failed'
export type BoardItem = Record<string, unknown> & { id: string; title: string; severity: Severity; confidence: number; location?: Location }
export type Board = {
  recommendedToPost: BoardItem[]; discussionOnly: BoardItem[]; alreadyCovered: BoardItem[]; discarded: BoardItem[]
  positiveObservations: string[]; summary: unknown; followUp: unknown; reviewMeta: Record<string, unknown>
}
export type PrMeta = { owner: string; repo: string; number: number; title: string; body: string; author: string; state: string; baseRef: string; headSha: string; mergeableState?: string }
export type RunState = {
  handle: string; phase: Phase; error?: string; warnings: string[]
  pr: PrMeta; checkoutPath: string; mergeBase: string; baseAheadCount: number; reviewerLogin: string
  diff: { nameStatus: string; numstat: string; shortstat: string }
  summary: { scale: string; changedFileCount?: number; additions?: number; deletions?: number; notableAreas: string[]; shapeUnavailable: boolean }
  lenses: { name: string; effort: string; rationale: string }[]; lensSource: 'selector' | 'all-lenses-fallback'
  threads: Thread[]; threadCollectionFailed: boolean; reviews: Review[]; reviewsCollectionFailed: boolean
  followUp: FollowUpContext | null
  run?: string; taskId?: string
  deposits: Record<string, Deposit>; verdicts: Verdict[] | null
  board?: Board; selected: string[]; drafts: Draft[]; event: ReviewEvent | null; posted: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'pr-review-toolkit': { run: RunState | null }
  }
}
