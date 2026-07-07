#!/usr/bin/env bash
set -euo pipefail

# Checkout a GitHub PR merge commit using git plumbing commands,
# excluding .claude/ from the working tree to avoid sandbox write
# restrictions. Output is consumed by skill pre-execution substitution.

skip() { printf 'CHECKOUT_SKIP: %s\n' "$1"; exit 0; }

# --- Input validation ---
pr_url="${1:-}"

if ! [[ "${pr_url}" =~ ^https://github\.com/[^/]+/[^/]+/pull/([0-9]+)(/.*)?$ ]]; then
    skip "invalid PR URL"
fi
pr_number="${BASH_REMATCH[1]}"

# --- Preflight ---
git rev-parse --show-toplevel >/dev/null 2>&1 \
    || skip "not a git repository"

git diff-index --quiet HEAD -- 2>/dev/null \
    || skip "worktree has uncommitted changes"

git remote get-url origin >/dev/null 2>&1 \
    || skip "no origin remote"

# --- Fetch ---
if ! git fetch origin "refs/pull/${pr_number}/merge" 2>/dev/null; then
    skip "merge ref fetch failed"
fi

# --- Plumbing checkout (excludes .claude/) ---
merge_sha="$(git rev-parse FETCH_HEAD)"

if ! {
    git read-tree "${merge_sha}" \
    && git ls-files -z -- . ':(exclude).claude/' \
        | git checkout-index -f -z --stdin \
    && git update-ref --no-deref HEAD "${merge_sha}"
}; then
    skip "plumbing checkout failed"
fi

# --- Resolve parents ---
base_sha="$(git rev-parse "HEAD^1")" || skip "could not resolve merge parents"
head_sha="$(git rev-parse "HEAD^2")" || skip "could not resolve merge parents"

# --- Output ---
printf 'CHECKOUT_OK\n'
printf 'mergeCommit %s\n' "${merge_sha}"
printf 'baseSha %s\n' "${base_sha}"
printf 'headSha %s\n' "${head_sha}"
printf 'NAME_STATUS\n'
git diff --name-status HEAD^1 HEAD
printf 'NUMSTAT\n'
git diff --numstat HEAD^1 HEAD
