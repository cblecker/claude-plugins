import type { Io } from './io'
import type { PrMeta, Review, ReviewState, Thread } from './types'

export type PrRef = { owner: string; repo: string; number: number }
export type PrEnvironment = { head: string; branch: string; origin: string; mergeConfig: string }

// GitHub MCP results are JSON of a shape this module checks field by field, so
// the raw values are `any` until a helper narrows them.

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// github.com as the whole host, in scp style (git@github.com:o/r.git) or URL style
// (https://, ssh://, with optional userinfo and port). Null for any other host.
export function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/(?:[^/]*@)?github\.com(?::\d+)?\/|(?:[^@/]+@)?github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(String(url || '').trim())
  return m ? { owner: m[1]!, repo: m[2]! } : null
}

// A URL origin without its userinfo, so an embedded token never reaches an error
// message or the pane: everything through the last `@` before the first `/` after
// the scheme goes (a password may itself hold an `@`). scp-style origins
// (git@host:path) carry no secret and pass through.
export function stripOriginCredentials(origin: string): string {
  return String(origin || '').replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/]*@/i, '$1')
}

// The PR number from a `gh pr checkout` merge key (branch.<name>.merge refs/pull/N/head).
export function prFromMergeConfig(config: string, branch: string): number | null {
  const line = String(config).split('\n').find((l) => l.startsWith(`branch.${branch}.merge `))
  const m = line && /refs\/pull\/(\d+)\/head$/.exec(line.trim())
  return m ? Number(m[1]) : null
}

export function parseShortstat(text: string): { fileCount: number; additions: number; deletions: number } {
  const n = (re: RegExp) => Number((re.exec(text) || [])[1] || 0)
  return { fileCount: n(/(\d+) files? changed/), additions: n(/(\d+) insertions?\(\+\)/), deletions: n(/(\d+) deletions?\(-\)/) }
}

// Call a GitHub MCP tool and parse its first text part as JSON. Throws on a tool
// error (with the tool's message) and on text that is not JSON. The server is
// bound inside the Io, so only the tool name appears here.
export async function mcpJson(io: Io, tool: string, args: Record<string, unknown>): Promise<any> {
  const r = await io.mcp(tool, args)
  const text = r?.content?.find((c) => typeof c?.text === 'string')?.text
  if (r?.isError) throw new Error(String(text || `${tool} failed`))
  return JSON.parse(String(text || 'null'))
}

// Find the PR this checkout belongs to (SKILL.md, Resolve The PR): the branch's
// merge key, then an exact head filter, then a scan of open PRs by head SHA, and the
// first route that yields a candidate wins. Resolution only has to produce the right
// candidate, not prove it: the head filter's PRs are candidates whatever their SHA
// (the caller's head-SHA check gives the precise "push or fetch" error), and only the
// scan matches on `head.sha`. One candidate is the answer; several or none is an error.
export async function resolvePr(io: Io, env: PrEnvironment): Promise<PrRef | { error: string }> {
  const or = parseOwnerRepo(env.origin)
  if (!or) return { error: `origin ${env.origin} is not a github.com repository` }
  const fromConfig = prFromMergeConfig(env.mergeConfig, env.branch)
  if (fromConfig) return { ...or, number: fromConfig }

  const listOpen = async (extra: Record<string, unknown>): Promise<any[]> => {
    const list = await mcpJson(io, 'list_pull_requests', { owner: or.owner, repo: or.repo, state: 'open', fields: ['number', 'head'], ...extra })
    if (!Array.isArray(list)) throw new Error('list_pull_requests returned an unexpected result')
    return list
  }
  const numbers = (list: any[], keep: (p: any) => boolean): number[] => list.filter((p) => keep(p) && typeof p?.number === 'number').map((p) => p.number)
  const advice = 'Check out the PR head, push local commits, or pick one PR.'
  const several = `Several open PRs in ${or.owner}/${or.repo} have head ${env.head}. ${advice}`

  let candidates: number[] = []
  let scanCapped = false
  try {
    if (env.branch !== 'HEAD') {
      candidates = numbers(await listOpen({ head: `${or.owner}:${env.branch}`, perPage: 10 }), () => true)
      if (candidates.length === 1) return { ...or, number: candidates[0]! }
      if (candidates.length > 1) return { error: several }
    }
    // Every page up to the cap is scanned, so a duplicate on a later page still
    // turns a match into "Several".
    scanCapped = true
    for (let page = 1; page <= 20; page++) {
      const list = await listOpen({ perPage: 100, page })
      candidates.push(...numbers(list, (p) => p?.head?.sha === env.head))
      if (list.length < 100) { scanCapped = false; break }
    }
  } catch (e) {
    return { error: `Could not list open PRs in ${or.owner}/${or.repo}: ${message(e)}` }
  }
  if (candidates.length > 1) return { error: several }
  if (candidates.length === 0) {
    return { error: scanCapped
      ? `No open PR among the first 2000 open PRs in ${or.owner}/${or.repo} has head ${env.head}; the scan stops there. ${advice}`
      : `No open PRs in ${or.owner}/${or.repo} have head ${env.head}. ${advice}` }
  }
  return { ...or, number: candidates[0]! }
}

// The PR's metadata (pull_request_read `get`). HTML-comment blocks (template
// instructions, bot markers) are dropped from the body. Throws when the read fails.
export async function fetchPr(io: Io, ref: PrRef): Promise<PrMeta> {
  const p = await mcpJson(io, 'pull_request_read', { method: 'get', owner: ref.owner, repo: ref.repo, pullNumber: ref.number })
  if (!p || typeof p !== 'object') throw new Error(`pull_request_read get returned no pull request for ${ref.owner}/${ref.repo}#${ref.number}`)
  return {
    owner: ref.owner, repo: ref.repo, number: ref.number,
    title: str(p.title), body: str(p.body).replace(/<!--[\s\S]*?-->/g, ''),
    author: str(p.user?.login), state: str(p.state), baseRef: str(p.base?.ref), headSha: str(p.head?.sha),
    mergeableState: typeof p.mergeable_state === 'string' ? p.mergeable_state : undefined,
  }
}

// A comment's author: get_review_comments gives the login as a plain string
// (`copilot-pull-request-reviewer`, with no `[bot]` suffix); an object form is tolerated.
const commentAuthor = (c: any): string => (typeof c?.author === 'string' ? c.author : str(c?.author?.login) || str(c?.user?.login))

// get_review_comments comments carry no numeric id; the REST comment id (what
// add_reply_to_pull_request_comment takes) is the `discussion_r<id>` anchor in html_url.
function commentId(c: any): number | undefined {
  if (typeof c?.id === 'number') return c.id
  const m = /discussion_r(\d+)/.exec(str(c?.html_url))
  return m ? Number(m[1]) : undefined
}

// One get_review_comments thread -> Thread. Null when it has no id or no comments.
// Thread flags are snake_case (`is_resolved`, `is_outdated`) and left undefined
// when the response does not say; `line` is absent on outdated comments, which
// keep `original_line`.
export function toThread(raw: any): Thread | null {
  const comments: any[] = Array.isArray(raw?.comments) ? raw.comments : []
  const first = comments[0]
  if (!raw?.id || !first) return null
  return {
    id: String(raw.id),
    commentId: commentId(first),
    path: str(first.path) || str(raw.path),
    line: num(first.line) ?? num(raw.line),
    originalLine: num(first.original_line) ?? num(raw.original_line),
    author: commentAuthor(first),
    body: str(first.body),
    isResolved: bool(raw.is_resolved),
    isOutdated: bool(raw.is_outdated),
    replies: comments.slice(1).map((c) => ({ author: commentAuthor(c), body: str(c?.body) })),
  }
}

// Every review thread on the PR, following `pageInfo.endCursor` via `after`. A
// tool error, unparsable result, a page without `review_threads`, or a thread
// that carries fewer comments than its `total_count` is a failed read; a PR with
// zero threads is a successful one.
export async function collectThreads(io: Io, ref: PrRef): Promise<{ threads: Thread[]; failed: boolean }> {
  try {
    const threads: Thread[] = []
    let after: string | undefined
    // A thread whose `total_count` exceeds the comments it carries was cut short:
    // the read goes on, but it is reported as incomplete.
    let truncated = false
    for (let i = 0; i < 50; i++) {
      const page = await mcpJson(io, 'pull_request_read', { method: 'get_review_comments', owner: ref.owner, repo: ref.repo, pullNumber: ref.number, perPage: 100, ...(after ? { after } : {}) })
      if (!Array.isArray(page?.review_threads)) return { threads: [], failed: true }
      for (const t of page.review_threads) {
        const th = toThread(t)
        if (th) threads.push(th)
        if (typeof t?.total_count === 'number' && t.total_count > (Array.isArray(t.comments) ? t.comments.length : 0)) truncated = true
      }
      if (!page.pageInfo?.hasNextPage) return { threads, failed: truncated }
      const next = page.pageInfo.endCursor
      // A missing or repeated cursor would refetch the same page forever.
      if (typeof next !== 'string' || !next || next === after) return { threads, failed: true }
      after = next
    }
    return { threads, failed: true }
  } catch { return { threads: [], failed: true } }
}

// One get_reviews item -> Review (the author is `user.login`, copied verbatim).
export function toReview(raw: any): Review {
  return {
    author: str(raw?.user?.login),
    state: raw?.state as ReviewState,
    commitId: str(raw?.commit_id) || undefined,
    submittedAt: str(raw?.submitted_at) || undefined,
    body: str(raw?.body),
  }
}

// The reviews `login` submitted on the PR (exact login match; bots such as
// `coderabbitai[bot]` never match), paging by number until a short page. With no
// login there is nothing to look for.
export async function collectReviews(io: Io, ref: PrRef, login: string): Promise<{ reviews: Review[]; failed: boolean }> {
  if (!login) return { reviews: [], failed: false }
  try {
    const reviews: Review[] = []
    for (let page = 1; page <= 20; page++) {
      const list = await mcpJson(io, 'pull_request_read', { method: 'get_reviews', owner: ref.owner, repo: ref.repo, pullNumber: ref.number, perPage: 100, page })
      if (!Array.isArray(list)) return { reviews: [], failed: true }
      for (const r of list) { const rv = toReview(r); if (rv.author === login) reviews.push(rv) }
      if (list.length < 100) return { reviews, failed: false }
    }
    return { reviews, failed: true }
  } catch { return { reviews: [], failed: true } }
}
