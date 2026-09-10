# Shared Specialist Guidance

Read this with the assigned lens and parent-supplied PR context. The lens prompts
are derived from Anthropic's Apache-2.0-licensed
[pr-review-toolkit](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pr-review-toolkit)
and the toolkit's Claude workflow. The two implementations evolve independently.

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

Use read-only inspection; do not fetch, edit files, execute project code or tests,
call GitHub write tools, or launch further agents. Thread collection belongs to
the collector, so specialists need not refetch GitHub data.

## Return Useful Evidence

Focus on issues introduced or exposed by this PR that a maintainer would act on.
Calibrate lens advice to the repository's actual needs: an absent log statement,
mutable type, or missing test alone does not establish a bug. Explain a concrete
failure path or violated contract; distinguish uncertainty from observed behavior.
Avoid style nits, speculative hardening, and recommendations that add complexity
without a demonstrated benefit.

For each candidate, explain the claim, file and head line when available, evidence,
why it matters, confidence, and a practical fix when clear. Preserve the reasoning
specific to your lens. Plain prose is sufficient. Return useful positive
observations and coverage limitations separately; a no-findings result describes
what was checked, not a guarantee that the PR is correct.
