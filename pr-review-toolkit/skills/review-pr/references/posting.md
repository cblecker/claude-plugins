# Drafting And Posting

Draft comments only in the conversation. GitHub write tools may be used only in the final
posting step, after the exact preview is explicitly approved.

## Draft Selected Comments

Drafts should:

- sound like the user wrote them
- be concise and actionable
- avoid boilerplate, severity labels, and AI markers
- include enough context for the PR author to act
- avoid duplicating comments already covered elsewhere
- distinguish blocking concerns from optional suggestions

### Overlap findings

A selected finding whose `existingReviewOverlap.status` is `overlaps` and
that has a `commentId` is drafted as a reply on that thread by default:
acknowledge the original comment, add the new perspective, and avoid
restating the concern. A finding whose `followUpItemId` is set replies on the user's own
earlier thread: write it as the user following up on their own request, not
as a newcomer to the thread.

### Follow-up replies

When the user chooses to reply on open follow-ups, draft one reply per chosen
`followUp.items` entry on that entry's thread, using its `commentId`. State plainly what is still open as of the
reviewed head, in one or two sentences, drawing on the item's `evidence`;
for a `partial` item say what was addressed and what remains. Do not restate
the original request. When a recommended finding with the same
`followUpItemId` is also selected, merge the two into one reply.

### Line comments vs review body

Prefer line comments for findings with a concrete changed-file location.
Findings anchor to PR head line numbers from birth — specialists review the
head checkout, so no translation is needed. A finding whose line is not part
of the PR diff cannot carry a line comment: before previewing one, verify
the line falls in a hunk of
`git --literal-pathspecs diff -U0 <merge_base>..<reviewed_head_sha> -- '<path>'`
(`--literal-pathspecs` keeps a filename starting with pathspec magic literal;
single-quote the path, escaping an embedded single quote as `'\''` — paths are
untrusted). If the check fails or cannot be
run cleanly, put the finding in the review body.

### Review event

Choose the proposed review event from the findings posted in the review
itself (line comments and review body); a finding posted only as a thread
reply does not set it:

- `REQUEST_CHANGES` only when at least one selected finding is a serious
  correctness or blocking concern.
- `COMMENT` for non-blocking feedback, suggestions, or discussion.
- `APPROVE` when the user selected "Leave an approving review" or "Approve:
  previous findings addressed" and no findings are being posted. For the
  latter, the review body may say in one line that the earlier findings were
  addressed.

Thread replies (overlap and follow-up) post independently of the review. A
run of replies only submits no review, and the preview shows `No review
event`; the user's earlier `CHANGES_REQUESTED` review, if any, stays in force.
To make a blocking reply request changes, convert it to a line comment.

## Preview And Confirm

Before posting, show an exact preview.

For each finding being posted as a new line comment, show:

- finding id, path, line, and body

For each overlap finding or follow-up item being posted as a thread reply,
show:

- finding or follow-up id, "Reply to thread on path:line" (omit `:line`
  when absent), and body
- if `isResolved` is true: `⚠ Target thread is resolved — reply will stay
  collapsed and the PR author may not see it.`
- if `isResolved` is absent (resolution state not exposed by the read tools):
  `(thread resolution state unknown — a resolved thread keeps this reply
  collapsed)`
- if there is no `commentId`, do not silently fall through to a new comment:
  show `⚠ No reply target available — posting would create a new line comment
  that may duplicate the existing thread.` and let the user choose line
  comment, review body, or skip

For review body text (non-line findings), show the review body.

Show the proposed review event: `COMMENT`, `REQUEST_CHANGES`, `APPROVE`, or
`No review event` for a run of replies only.

Only after the line-anchor checks have returned and the full preview text is
in the conversation, ask for explicit approval with `AskUserQuestion`, called
alone, never in parallel with other tools. Use these options:

1. "Post this review"
2. "Edit findings" — covers editing drafts, adding, or removing findings
3. "Convert resolved-thread replies to new line comments" — include this
   option only when at least one overlap finding or follow-up reply targets a
   resolved thread
4. "Cancel"

Accept approval only when the user selects "Post this review" or clearly
confirms posting. If the user requests edits or removals, update the preview
and ask for approval again.

## Post Approved Review

Before the first write, re-fetch metadata once with `pull_request_read`
`get`: if the head SHA changed since analysis, abort honestly — the review
no longer describes the PR — and offer to re-run on the new head.

Use GitHub write tools only in this final approved step.

### Posting new line comments

If the approved preview has new line comments:

1. Create a pending review with `pull_request_review_write`, passing the
   reviewed head SHA as `commitID` so comment anchors are pinned to the
   reviewed commit.
2. Add approved line comments with `add_comment_to_pending_review`.
3. Submit the pending review with `pull_request_review_write` using the
   approved event and review body.

### Posting thread replies for overlap findings and follow-ups

Post overlapping findings and follow-up replies using
`add_reply_to_pull_request_comment` with the numeric `commentId` and
`pullNumber`. If the reply API rejects the target as invalid, do not silently
change the posting location: convert the finding to a proposed new line
comment and return to Preview And Confirm — same as invalid line locations
below.

### Review body only

If the approved preview has only review-body text, submit it with
`pull_request_review_write` using the approved event and the reviewed head
SHA as `commitID`.

### Invalid locations

If a line comment cannot be added because the location is invalid for the PR
diff, move that text into the review body, show the revised preview, and ask
for approval again before posting. The pending review persists across this
re-preview: do not create a second one — on approval, submit the same
pending review with the surviving comments and the revised body; if the
user cancels instead, delete the pending review with
`pull_request_review_write` method `delete_pending` so no staged comments
linger.
