#!/usr/bin/env bash
set -euo pipefail

# Checkout a GitHub PR merge commit using git plumbing commands,
# excluding sandbox-protected files from the working tree.
# Output is consumed by skill pre-execution substitution.

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

# --- Plumbing checkout (excludes sandbox-protected files) ---
merge_sha="$(git rev-parse FETCH_HEAD)"

git read-tree "${merge_sha}" || skip "read-tree failed"

# Exclude files on the sandbox mandatory-deny list (DANGEROUS_FILES,
# DANGEROUS_DIRECTORIES in anthropic-experimental/sandbox-runtime).
# These are always write-protected regardless of sandbox config;
# checkout-index would fail with EPERM trying to unlink them.
git ls-files -z -- . \
    ':(glob,exclude)**/.gitconfig' \
    ':(glob,exclude)**/.gitmodules' \
    ':(glob,exclude)**/.bashrc' \
    ':(glob,exclude)**/.bash_profile' \
    ':(glob,exclude)**/.zshrc' \
    ':(glob,exclude)**/.zprofile' \
    ':(glob,exclude)**/.profile' \
    ':(glob,exclude)**/.ripgreprc' \
    ':(glob,exclude)**/.mcp.json' \
    ':(glob,exclude)**/.claude/**' \
    ':(glob,exclude)**/.vscode/**' \
    ':(glob,exclude)**/.idea/**' \
    | git checkout-index -f -z --stdin \
    || skip "checkout-index failed"

git update-ref --no-deref HEAD "${merge_sha}" || skip "update-ref failed"

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
