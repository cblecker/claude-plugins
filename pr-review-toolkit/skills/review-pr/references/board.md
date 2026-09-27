# Review Board

## Present Review Board

Use this order:

### 1. Heading

Format: `owner/repo#number — PR title`

Below the heading, include a one-line summary with section counts derived
from section array lengths, plus the reviewer list from
`reviewMeta.selectedReviewers` (full agent names): `N recommended, M other
findings, K not posting. Reviewers: code-reviewer, pr-test-analyzer.` where
K is `alreadyCovered.length + discarded.length`. If `reviewMeta.lensSelection.source` is
`all-lenses-fallback`, add a line: the lens selector returned invalid
output, so every lens ran. Add a one-line shape summary from `summary`
(file count, additions/deletions, scale, notable areas — or that the shape
is unavailable); per-lens rationales live in
`reviewMeta.lensSelection.rationales` when the user asks.

Then show merge signals from the metadata and the pinned range:

- `mergeable` is false → `⚠ This PR has merge conflicts with <base.ref>.`
- `mergeable` is null → `Mergeability is still computing on GitHub.`
- `base_ahead_count` > 0 → `<base.ref> has moved <base_ahead_count> commits
  since this PR forked.`

If `reviewMeta.threadCollectionFailed` is true, warn: existing review threads
could not be collected, so overlap classification and follow-up detection are
unavailable and recommended findings may duplicate existing comments.

If `reviewMeta.failedReviewers` is non-empty, warn: name those lenses and say
they did not complete, so the board is missing their coverage and the review is
narrower than the reviewer list suggests.

### 2. Follow-up review

Include this section only when `followUp` is not null.

Header line, from `followUp`: `Follow-up review — you (@reviewerLogin)
reviewed <reviewedCommit, 7 chars> on <reviewedAt, date only>
(<reviewState>); <n> commits since.` Compute `n` with
`git rev-list --count <reviewedCommit>..HEAD`. If that command fails, the
reviewed commit is not in this checkout (the branch was rewritten since your
review): say so in place of the count. When `reviewedCommit` is empty (threads
but no submitted review), write `you opened <threadCount> threads without a
submitted review` instead.

Then one line per entry of `followUp.items`, in order:
`<glyph> <id> <path>:<line> — <ask> → <evidence>[; fixed in <fixedIn>]; thread
<resolved|unresolved>[, outdated]` with glyphs ✅ `addressed`, ⚠️ `partial`,
❌ `not_addressed`, ❓ `unverifiable`. Omit the thread state words whose
flags are absent.

If `followUp.verifierFailed` is true, say the follow-up verifier did not
complete, so every item is unverifiable. Otherwise, if `reviewedCommit` is
set and `deltaAvailable` is false, say verdicts rest on the current code and
thread replies only, because the reviewed commit is not in the checkout.

### 3. Recommended to post (full detail)

For each finding, include:

- stable id, location, lens, title, severity, confidence
- when `changedSinceLastReview` is present: `changed since your review` or
  `unchanged since your review`
- overlap tag when `existingReviewOverlap.status` is `overlaps`:
  `↳ follows up <followUpItemId> (your thread, resolved|unresolved)` when
  `followUpItemId` is set, otherwise `↳ overlaps @<threadAuthor> thread on
  <threadPath>:<threadLine> (resolved|unresolved)`, omitting the state word
  when `isResolved` is absent; append `→ posts as a reply` when
  `existingReviewOverlap.commentId` is set, else `→ no reply target`
- claim
- evidence
- why it matters
- suggested fix or next step
- recommendation rationale: one sentence explaining why this finding is
  recommended for posting, synthesized from severity, confidence, and overlap
  status

### 4. Other findings (full detail)

Findings from `discussionOnly`: same fields as recommended, ending with
`Not recommended: <reason>` — the item's `routingNote` when set, otherwise one
sentence from severity, confidence, and the overlap rationale. Introduce the
section with: say `promote F<n>` to move a finding into Recommended.

### 5. Not posting (one-liner per finding)

First `alreadyCovered`: `id — title (covered by @<threadAuthor> thread on
<threadPath>:<threadLine>, resolved|unresolved)`, or `(covered by your thread
...)` when `followUpItemId` is set; fall back to the finding's own location
when the thread descriptors are absent. Then `discarded`: `id — title
(discarded: reason)`.

### 6. Positive observations

List positive observations when present.

## Ask What To Do Next

After presenting the board, propose a recommended action based on board state
using `AskUserQuestion` with contextual options. "Open follow-ups" below means
`followUp.items` entries whose status is `partial` or `not_addressed`.

### When recommended findings exist

Write a brief assessment of the recommended findings and any notable
overlaps, then offer options:

1. "Draft recommended findings" (the description notes that findings tagged as overlapping a thread are drafted
   as replies on that thread)
2. "Draft recommended + reply on open follow-ups (P2, P4)" — include only when
   open follow-ups exist, naming their ids
3. "I want to adjust the selection"
4. "Cancel"

### When nothing is recommended but open follow-ups exist

1. "Reply on open follow-ups (P2, P4)"
2. "Skip posting"
3. "I want to discuss specific findings"
4. "Cancel"

### When nothing is recommended and your earlier findings are all addressed

`followUp.items` is non-empty and every item is `addressed`:

1. "Approve: previous findings addressed"
2. "I spotted something"
3. "Done"

### When nothing is recommended but other findings exist

1. "Skip posting"
2. "I want to discuss specific findings"
3. "Leave an approving review"
4. "Cancel"

### When nothing is postable otherwise

1. "Leave an approving review"
2. "I spotted something"
3. "Done"

In either of the last two cases, if any `followUp.items` entry is
`unverifiable`, name those items before the options: approving would approve
requests nobody verified.

The user may type free-form text via Other (e.g., "Tell me more about F3").
Respond accordingly and loop back to updated options. Handle these requests
directly on the board state, then re-present the counts and the menu:

- `promote F<n>` moves the finding into Recommended; `demote F<n>` moves it
  into Other findings.
- "too picky", "be less picky", or "I have reviewed this before" demotes into
  Other findings every recommended finding that is not `critical` and whose
  `changedSinceLastReview` is not `true`, each with the note `Demoted at your
  request.` When no finding carries `changedSinceLastReview`, demote every
  non-critical recommended finding.
