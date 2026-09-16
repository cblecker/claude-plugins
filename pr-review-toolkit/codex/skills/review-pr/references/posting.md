# Drafting And Posting

Read when the user selects findings to draft, endorse, or post. Drafts remain in
the conversation until the user approves an exact preview. Only the parent uses
GitHub write tools, and only for the approved feedback.

## Draft Selected Feedback

Write concise, actionable comments in the user's voice. Include the context the
author needs, distinguish blockers from suggestions, and omit severity labels,
boilerplate, and AI markers. Draft only the selected findings.

For overlaps, reply to the existing thread with the additional evidence or chosen
endorsement, rather than restating the concern. Keep its verified numeric comment
ID and URL. An unavailable reply target requires a user choice of new line
comment, review body, or skip; never silently redirect feedback.

For new line comments, verify that the PR head location falls in an added-side
hunk of `git --literal-pathspecs diff --no-ext-diff --no-textconv -U0 <mergeBase>..<headSha> -- '<path>'`.
Quote paths safely and use `RIGHT` for head-side comments. If the line is outside
the diff, deleted, or cannot be verified, propose the text in the review body.

Propose `REQUEST_CHANGES` only for a selected serious correctness or blocking
concern. Use `COMMENT` for non-blocking feedback and endorsements. Use `APPROVE`
only when the user explicitly chooses an approving review.

## Preview And Obtain Approval

On entering the final-preview stage, refresh current review-thread context using
[thread collection guidance](threads.md) and reconsider overlap for the selected
findings. Keep selections and finding IDs stable, and show any changed
recommendation, draft text, or proposed target. An incomplete refresh means
unknown coverage, never an empty discussion; disclose it and qualify overlap.
This refresh does not change the pinned range or checkout.

Before previewing a review submission, identify the authenticated reviewer and
read existing reviews. If that reviewer has a pending review, inspect its staged
comments and ask whether to include it. Reuse requires deliberate selection and
approval of every staged item; show all of them in the exact preview. Never
delete or submit pending work outside that approval. If its contents or
ownership cannot be verified, stop the review submission and explain why.

Show the exact PR and reviewed head, review event and body, and every selected
comment's finding ID, path, line, side, and text. For each reply show its thread
URL, numeric target ID, and exact text. State that replies publish immediately,
independently of the review submission. A replies-only selection does not require
an empty review; preview it as replies only.

For a resolved thread, warn that the reply remains collapsed and may be missed.
If resolution state is unavailable, say it is unknown. A proposed change of
location or conversion from reply to new comment must appear in the preview.

Ask for explicit approval of this preview. A request to review, a selected
finding, or approval of the board is not approval to post. Any change to approved
text or targets, whether requested or prompted by refreshed discussion, requires
a revised preview and approval before writing.

## Post The Approved Preview

Immediately before **each** GitHub write, including resumed writes, read PR
metadata with `pull_request_read` (`get`). If closed or its head differs from the
reviewed SHA, stop, report what already succeeded, and offer a new review.

For new inline comments, use `pull_request_review_write` to create a pending
review pinned with `commitID: <headSha>` (or reuse the explicitly approved
pending review). Add only the approved comments with
`add_comment_to_pending_review`, then submit the approved event and body through
`pull_request_review_write`. For a body-only review, submit with the same pinned
`commitID`. Recheck pending-review contents before submission; unexpected staged
content requires a new preview and approval.

Post approved thread replies with `add_reply_to_pull_request_comment`, using the
verified numeric `commentId` and `pullNumber`. If a reply target is rejected, stop
that item and propose a new target for approval. If an inline anchor is rejected,
propose that text in the review body and obtain approval of the revised preview.
Retain the same pending review while correcting locations; include its already
staged comments in the new preview.

## Partial Failures And Cancellation

Track the approved preview, owned pending-review ID, successful staged comments,
submitted review URL, and published reply IDs in the conversation. After a failure
or ambiguous response, read GitHub state before retrying. Report confirmed
successes and unresolved operations; never replay a successful reply or review.
If state cannot be reconciled, stop and ask the user how to proceed.

Cancel only a pending review created by this flow, with user authorization for
deletion. The head check still applies to cleanup: if the PR closed or moved,
leave the pending review intact and report it for manual cleanup. Never delete
an unrelated pending review or a published comment. Show any remaining staged
work and already published replies when the user cancels.
