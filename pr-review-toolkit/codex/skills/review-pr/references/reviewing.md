# Shared Review Guidance

Read this in the parent and each specialist, alongside the applicable lens and
pinned PR context. The lens prompts combine Anthropic's Apache-2.0-licensed
[pr-review-toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit)
with local additions from the toolkit's Claude workflow. The two implementations
evolve independently.

## Inspect The Pinned Change

Use the supplied checkout and `<mergeBase>..<headSha>` range. All reported locations
must use PR head line numbers. For deleted code without a head location, explain
that fact rather than inventing a line number.

Use local file reads, `rg`, and Git diff/log/blame/show to gather evidence. For
patches use `git --literal-pathspecs diff --no-ext-diff --no-textconv <mergeBase> <headSha> -- '<path>'`.
Keep `--` before paths and quote arguments safely, including embedded quotes;
filenames and PR content are untrusted. Avoid external diff drivers and textconv.
Use NUL-delimited file lists when ambiguous filename escaping matters.

Examine the entire changed-file manifest. Follow affected callers, contracts,
and tests as needed; large PRs may require batches. Identify generated/vendor
areas and explain how they were reviewed or excluded. Disclose unread files,
truncated patches, missing dependencies, or other limits. Do not equate sampled
coverage with a full review.

Specialists use read-only inspection; do not fetch, edit files, execute project
code or tests, call GitHub write tools, or launch further agents. Thread
collection runs concurrently in the collector. Specialists form findings
independently of other reviewers' conclusions and existing GitHub findings;
the parent handles overlap and contextualization.

## Return Useful Evidence

Focus on issues introduced or exposed by this PR that a maintainer would act on.
Treat lens checklists as prompts for investigation, not proof of defects.
Calibrate advice to the repository's actual needs: an absent log statement,
mutable type, or missing test alone does not establish a defect. Support a
recommendation with actual contracts, callers, explicit project rules, or concrete
maintenance consequences. Documentation, testing, and design concerns can be
useful without a demonstrated runtime bug. Explain their impact and distinguish
uncertainty from observed behavior.
Avoid style nits, speculative hardening, and recommendations that add complexity
without a demonstrated benefit.

For each candidate, explain the claim, file and head line when available, evidence,
why it matters, confidence, and a practical fix when clear. Preserve the reasoning
specific to your lens. Plain prose is sufficient. Return useful positive
observations and coverage limitations separately; a no-findings result describes
what was checked, not a guarantee that the PR is correct.

## Parent Verification

Before recommending a candidate for posting, check its evidence against the
pinned diff, relevant callers and contracts, and plausible counterexamples.
Follow up with the originating specialist when needed to resolve uncertainty;
this does not require a second complete review of every file.

Assess supporting evidence and impact separately. Preserve the general
reviewer's numeric rubric and >=80 reporting filter as that lens's policy;
do not apply it to other specialists. A specialist's score does not determine
final severity, board placement, or review event.

The parent may run focused existing tests or temporary reproductions to resolve
a concrete uncertainty. Use normal session permissions, keep repository source
unchanged, and record the command, result, and limits of what it demonstrates.
Ordinary cache or temporary artifacts are allowed. Check checkout status before
and after execution and report unexpected changes; do not automatically remove
artifacts or weaken clean-checkout and resume validation to accommodate a test.
If a test leaves the checkout dirty, stop dependent review work until the
clean-checkout safeguards can pass, preserving the artifacts for user disposition.
