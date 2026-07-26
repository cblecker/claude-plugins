#!/usr/bin/env bash
set -euo pipefail

# Checkout a GitHub PR merge commit using git plumbing commands,
# excluding sandbox-protected files from the working tree.
# Output is consumed by skill pre-execution substitution.

skip() { printf 'CHECKOUT_SKIP: %s\n' "$1"; exit 0; }

# --- Input validation ---
pr_url="${1:-}"

if ! [[ "${pr_url}" =~ ^https://github\.com/([^/?#]+)/([^/?#]+)/pull/([0-9]+)([/?#].*)?$ ]]; then
    skip "invalid PR URL"
fi
pr_owner="${BASH_REMATCH[1]}"
pr_repo="${BASH_REMATCH[2]}"
pr_number="${BASH_REMATCH[3]}"

# --- Preflight ---
toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" \
    || skip "not a git repository"
cd "${toplevel}"

git update-index -q --refresh 2>/dev/null || true
git diff-index --quiet HEAD -- 2>/dev/null \
    || skip "worktree has uncommitted changes"

origin_url="$(git remote get-url origin 2>/dev/null)" \
    || skip "no origin remote"

# Origin must point at github.com and match the PR base repository before
# anything is fetched. PR URLs are always github.com, so a same-named repo
# on another host must not be fetched from. Host extraction: strip the
# scheme, strip userinfo, cut at the first colon or slash.
origin_host="$(printf '%s' "${origin_url}" \
    | sed -E -e 's|^[a-zA-Z][a-zA-Z0-9+.-]*://||' -e 's|^[^/@]*@||' -e 's|[:/].*$||' \
    | tr '[:upper:]' '[:lower:]')"
if [[ "${origin_host}" != "github.com" ]]; then
    skip "origin host is not github.com"
fi

# Normalize both sides to lowercase {owner}/{repo}: strip trailing slashes
# and .git, then take the last two path components (covers https, ssh,
# and scp-style URLs).
normalized_origin="$(printf '%s' "${origin_url}" \
    | sed -e 's|/*$||' -e 's|\.git$||' -e 's|:|/|g' \
    | awk -F/ 'NF>=2 {print tolower($(NF-1))"/"tolower($NF)}')"
expected_repo="$(printf '%s/%s' "${pr_owner}" "${pr_repo}" | tr '[:upper:]' '[:lower:]')"
if [[ "${normalized_origin}" != "${expected_repo}" ]]; then
    skip "origin does not match PR base repository"
fi

# --- Fetch ---
if ! git fetch origin "refs/pull/${pr_number}/merge" 2>/dev/null; then
    skip "merge ref fetch failed"
fi

merge_sha="$(git rev-parse FETCH_HEAD)"
orig_head="$(git rev-parse HEAD)"

# --- Resolve parents and verification data before mutating anything ---
base_sha="$(git rev-parse --verify -q "${merge_sha}^1")" \
    || skip "could not resolve merge parents"
head_sha="$(git rev-parse --verify -q "${merge_sha}^2")" \
    || skip "could not resolve merge parents"

# File count of the base...head PR diff, for comparison against GitHub's
# changedFiles. May be unavailable in shallow clones; omitted when unknown.
pr_diff_file_count=""
if merge_base="$(git merge-base "${base_sha}" "${head_sha}" 2>/dev/null)"; then
    pr_diff_file_count="$(git diff --name-only "${merge_base}" "${head_sha}" | wc -l | tr -d '[:space:]')"
fi

# File count of the merge diff itself, so the workflow can verify the parsed
# manifest is complete before trusting it.
merge_diff_file_count="$(git diff --name-only "${base_sha}" "${merge_sha}" | wc -l | tr -d '[:space:]')"

# Exclude files on the sandbox mandatory-deny list (DANGEROUS_FILES,
# DANGEROUS_DIRECTORIES in anthropic-experimental/sandbox-runtime).
# These are always write-protected regardless of sandbox config;
# checkout-index and rm would fail with EPERM touching them.
protected_pathspecs=(
    ':(glob,exclude)**/.gitconfig'
    ':(glob,exclude)**/.gitmodules'
    ':(glob,exclude)**/.bashrc'
    ':(glob,exclude)**/.bash_profile'
    ':(glob,exclude)**/.zshrc'
    ':(glob,exclude)**/.zprofile'
    ':(glob,exclude)**/.profile'
    ':(glob,exclude)**/.ripgreprc'
    ':(glob,exclude)**/.mcp.json'
    ':(glob,exclude)**/.claude/**'
    ':(glob,exclude)**/.vscode/**'
    ':(glob,exclude)**/.idea/**'
)

checkout_worktree() {
    git ls-files -z -- . "${protected_pathspecs[@]}" \
        | git checkout-index -f -z --stdin
}

# Restore the index and worktree to the original HEAD when the checkout
# fails partway, so preflight stays clean for reruns and the MCP fallback
# does not inherit a half-mutated repository. Files the merge added are
# removed first: checkout-index never deletes, so they would otherwise
# survive as untracked merge-content debris. Returns non-zero when the
# tracked index/worktree state could not be confirmed restored.
restore_original() {
    local restore_ok=0
    while IFS= read -r -d '' added_path; do
        rm -f -- "${added_path}" 2>/dev/null || true
        added_dir="$(dirname -- "${added_path}")"
        if [[ "${added_dir}" != "." ]]; then
            rmdir -p -- "${added_dir}" 2>/dev/null || true
        fi
    done < <(git diff --name-only -z --no-renames --diff-filter=A \
        "${orig_head}" "${merge_sha}" -- . "${protected_pathspecs[@]}" 2>/dev/null)
    git read-tree "${orig_head}" 2>/dev/null || restore_ok=1
    checkout_worktree 2>/dev/null || restore_ok=1
    return "${restore_ok}"
}

# Fail the checkout: restore the original state, then skip with a reason.
# A failed restore is not silent — the skip reason says the repository
# needs manual recovery so the user is never misled about its state.
fail_checkout() {
    if restore_original; then
        skip "$1"
    else
        skip "$1; restore incomplete — run 'git reset --hard' in the review worktree to recover"
    fi
}

# Refuse to overwrite untracked local files, matching git checkout's own
# guard: a path the merge adds that already exists on disk as any
# non-directory inode (regular file, symlink, FIFO, socket, device) is
# untracked data (preflight verified tracked content is clean, and a
# tracked file at an added path is impossible), and checkout-index -f
# would silently replace it — and a later rollback would delete it. Runs
# before any mutation. A directory at an added path is a dir-to-file type
# change: its tracked contents are removed by the stale-path loop below,
# and untracked leftovers make checkout-index fail into the rollback path
# instead of losing data.
while IFS= read -r -d '' added_path; do
    if [[ (-e "${added_path}" || -L "${added_path}") && ! -d "${added_path}" ]]; then
        skip "untracked files would be overwritten by the merge checkout"
    fi
done < <(git diff --name-only -z --no-renames --diff-filter=A \
    "${orig_head}" "${merge_sha}" -- . "${protected_pathspecs[@]}")

# --- Plumbing checkout (excludes sandbox-protected files) ---
git read-tree "${merge_sha}" || fail_checkout "read-tree failed"

# Remove files present at the original HEAD but absent from the merge
# result (checkout-index never deletes), so stale content is not visible
# to Read/Grep on the merged checkout. --no-renames decomposes renames
# into delete+add so old rename sources are removed too. Runs before
# checkout-index so type changes (file -> directory) do not collide.
while IFS= read -r -d '' stale_path; do
    if ! rm -f -- "${stale_path}"; then
        fail_checkout "stale file removal failed"
    fi
    stale_dir="$(dirname -- "${stale_path}")"
    if [[ "${stale_dir}" != "." ]]; then
        rmdir -p -- "${stale_dir}" 2>/dev/null || true
    fi
done < <(git diff --name-only -z --no-renames --diff-filter=D \
    "${orig_head}" "${merge_sha}" -- . "${protected_pathspecs[@]}")

checkout_worktree || fail_checkout "checkout-index failed"

git update-ref --no-deref HEAD "${merge_sha}" || fail_checkout "update-ref failed"

# Protected paths the merge modified or added stay at their original
# worktree content, so the index (merge version) would read as dirty and
# block reruns. Mark them skip-worktree: git then treats the untouched
# worktree copy as intentional.
protected_match=()
for spec in "${protected_pathspecs[@]}"; do
    protected_match+=("${spec/,exclude/}")
done
while IFS= read -r -d '' protected_path; do
    git update-index --skip-worktree -- "${protected_path}" 2>/dev/null || true
done < <(git diff --name-only -z --no-renames --diff-filter=AM \
    "${orig_head}" "${merge_sha}" -- "${protected_match[@]}" 2>/dev/null)

# read-tree leaves index entries without stat data; refresh so the checkout
# reads as clean to git status and to this script's own preflight on reruns.
git update-index -q --refresh 2>/dev/null || true

# --- Output ---
printf 'CHECKOUT_OK\n'
printf 'mergeCommit %s\n' "${merge_sha}"
printf 'baseSha %s\n' "${base_sha}"
printf 'headSha %s\n' "${head_sha}"
if [[ -n "${pr_diff_file_count}" ]]; then
    printf 'prDiffFileCount %s\n' "${pr_diff_file_count}"
fi
printf 'mergeDiffFileCount %s\n' "${merge_diff_file_count}"
printf 'NAME_STATUS\n'
git diff --name-status "${base_sha}" "${merge_sha}"
printf 'NUMSTAT\n'
git diff --numstat "${base_sha}" "${merge_sha}"
