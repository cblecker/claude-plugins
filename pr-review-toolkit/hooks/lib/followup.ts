import type { Io } from './io'
import type { Delta, FollowUpContext, Review, ReviewSummary, Thread } from './types'

// A commit SHA. Commit ids from GitHub reach git command lines, so only this shape is accepted.
const SHA_RE = /^[0-9a-f]{7,40}$/

// Follow-up detection: the reviewer's own threads and submitted reviews,
// recognised by login. Without a login every run is a first review. A port of
// the pre-3.0 review-pr workflow's follow-up detection; logins compare
// exactly, as there: a human reviewer's thread and review authors are the same
// string, and an account that differs in case or by a `[bot]` suffix is a
// different account.
// Returns null when this is a first review; the caller adds the delta.
export function detectFollowUp(threads: Thread[], reviews: Review[], login: string, prAuthor: string): Omit<FollowUpContext, 'delta'> | null {
  // On the reviewer's own PR their threads and comments are author notes, not
  // a review of the code, so follow-up detection is skipped.
  const followUpLogin = login !== '' && login.toLowerCase() !== String(prAuthor || '').toLowerCase() ? login : ''
  if (!followUpLogin) return null

  const myThreads = threads.filter((thread) => thread && thread.author === followUpLogin)
  const myReviews = reviews
    .filter((review) => review && review.author === followUpLogin && review.state !== 'PENDING')
    // ISO-8601 timestamps order lexically; latest first.
    .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')))
  // A standalone thread reply creates its own COMMENTED review with an empty
  // body. Skip those so replying (including via this skill) never moves the
  // baseline or makes a PR author who only replied look like a reviewer. An
  // inline-only COMMENTED review is indistinguishable, so it counts only when
  // the reviewer has threads and nothing more substantive exists.
  const hasBody = (review: Review): boolean => typeof review.body === 'string' && review.body.trim() !== ''
  const substantive = myReviews.filter((review) => review.state !== 'COMMENTED' || hasBody(review))
  const lastReview = substantive[0] || (myThreads.length > 0 ? myReviews[0] || null : null)
  // Summaries of the reviewer's reviews, oldest first. The verifier decides
  // which of their asks still apply; encoding GitHub's review-state rules here
  // is what it is better placed to judge. Bodyless decisions stay in as state
  // markers, so an approval between two commented summaries still withdraws
  // the earlier asks; only the empty COMMENTED reviews that thread replies
  // create are left out.
  const myReviewSummaries: ReviewSummary[] = myReviews
    .filter((review) => hasBody(review) || review.state !== 'COMMENTED')
    .reverse()
    .map((review) => ({
      state: review.state,
      submittedAt: review.submittedAt || '',
      body: hasBody(review) ? review.body.trim() : '',
    }))
  if (myThreads.length === 0 && !lastReview) return null

  // commitId is remote data interpolated into git commands; accept only a commit SHA.
  const reviewedCommit = lastReview && SHA_RE.test(String(lastReview.commitId || ''))
    ? String(lastReview.commitId)
    : ''
  return {
    reviewedCommit,
    reviewedAt: lastReview ? String(lastReview.submittedAt || '') : '',
    reviewState: lastReview ? String(lastReview.state || '') : '',
    threads: myThreads,
    reviewSummaries: myReviewSummaries,
  }
}

type FileHunks = NonNullable<Delta['files']>[number]

const SIMPLE_ESCAPES: Record<string, string> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '"': '"', '\\': '\\' }

// Decode a run of octal-escaped bytes as UTF-8; bytes that are not valid UTF-8
// come back one char per byte.
function decodeBytes(bytes: number[]): string {
  if (bytes.length === 0) return ''
  try { return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join('')) }
  catch { return String.fromCharCode(...bytes) }
}

// A path from a `+++ ` header: git C-quotes it (`"b/t\tab.go"`) when it holds
// control characters, quotes or backslashes (and non-ASCII bytes unless
// core.quotePath=false), and appends a tab to an unquoted path that holds a space.
function headerPath(raw: string): string {
  if (!raw.startsWith('"')) return raw.endsWith('\t') ? raw.slice(0, -1) : raw
  const end = raw.lastIndexOf('"')
  const inner = raw.slice(1, end > 0 ? end : raw.length)
  let out = ''
  let bytes: number[] = []
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!
    if (ch !== '\\') { out += decodeBytes(bytes) + ch; bytes = []; continue }
    const octal = /^[0-7]{3}/.exec(inner.slice(i + 1))
    if (octal) { bytes.push(parseInt(octal[0], 8)); i += 3; continue }
    out += decodeBytes(bytes); bytes = []
    const next = inner[i + 1]
    if (next !== undefined) { out += SIMPLE_ESCAPES[next] ?? next; i++ }
  }
  return out + decodeBytes(bytes)
}

// Parse `git diff` output (any amount of context) into the head-side line
// ranges each file's hunks cover, one `[first, last]` pair per `@@` header:
// [c, c+d-1], where d is 1 when omitted and a pure deletion (d = 0) is [c, c].
// Files are keyed by their `b/` path. A deleted file (`+++ /dev/null`) has no
// head lines, so it gets no entry; neither do binary files or pure renames,
// which carry no `+++` header. The diff must use the `a/` and `b/` prefixes
// (pass `--src-prefix=a/ --dst-prefix=b/`: diff.noprefix and
// diff.mnemonicPrefix change them). Hunk bodies are consumed by their header
// counts, so a content line that looks like a header never starts a file.
export function parseDeltaHunks(diff: string): FileHunks[] {
  const files: FileHunks[] = []
  let cur: FileHunks | null = null
  let oldLeft = 0
  let newLeft = 0
  for (const line of diff.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      const c = line[0]
      if (c === '+') { newLeft--; continue }
      if (c === '-') { oldLeft--; continue }
      // git writes a blank context line as a single space; tolerate one whose
      // trailing space was stripped.
      if (c === ' ' || c === undefined) { oldLeft--; newLeft--; continue }
      if (c === '\\') continue
      // Not a body line after all (a miscounted or truncated hunk): read it as a header.
      oldLeft = 0
      newLeft = 0
    }
    if (line.startsWith('diff --git ')) { cur = null; continue }
    if (line.startsWith('+++ ')) {
      const path = headerPath(line.slice(4))
      cur = path.startsWith('b/') ? { path: path.slice(2), hunks: [] } : null
      if (cur) files.push(cur)
      continue
    }
    const h = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (h) {
      oldLeft = h[1] === undefined ? 1 : Number(h[1])
      newLeft = h[3] === undefined ? 1 : Number(h[3])
      if (cur) {
        const start = Number(h[2])
        cur.hunks.push(newLeft === 0 ? [start, start] : [start, start + newLeft - 1])
      }
    }
  }
  return files
}

const GIT_TIMEOUT_MS = 120000

// What changed since the commit the reviewer last reviewed: the number of
// commits and, per changed file, the head-side line ranges of each change.
// Any failure (a commit that is not a SHA, one that is not an ancestor of head
// such as after a force-push, git failing or not running, or a diff the host
// truncated) is `available: false`: a file missing from `files` reads as
// unchanged, so an incomplete file list is never given. What the diff has no
// hunk for still reads as unchanged, as in the original workflow: binary files
// and pure renames.
export async function computeDelta(io: Io, root: string, reviewedCommit: string, head: string): Promise<Delta> {
  // Both are remote data on a git command line: a SHA, and nothing an option could be.
  if (!SHA_RE.test(reviewedCommit)) return { available: false }
  if (head === '' || head.startsWith('-')) return { available: false }
  const opts = { cwd: root, timeoutMs: GIT_TIMEOUT_MS }
  try {
    // Exit 1 is the normal "not an ancestor" answer, so this does not use git(), which throws.
    const anc = await io.run(['git', 'merge-base', '--is-ancestor', reviewedCommit, head], opts)
    if (anc.exitCode !== 0) return { available: false }
    const range = `${reviewedCommit}..${head}`
    const count = await io.run(['git', 'rev-list', '--count', range], opts)
    const diff = await io.run([
      'git', '-c', 'core.quotePath=false', '--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv',
      '--src-prefix=a/', '--dst-prefix=b/', '-U0', '--inter-hunk-context=5', range, '--',
    ], opts)
    if (count.exitCode !== 0 || diff.exitCode !== 0) return { available: false }
    // The host keeps only the first 4 MiB of stdout; the rest of a cut diff is files that would read as unchanged.
    if (diff.truncated) return { available: false }
    return { available: true, commitsSince: Number(String(count.stdout).trim()) || 0, files: parseDeltaHunks(String(diff.stdout)) }
  } catch {
    return { available: false }
  }
}
