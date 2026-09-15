# Source after the user's gh and codex aliases have been defined.
codex-review-pr() {
  if [[ $# != 1 ]]; then
    printf 'Usage: codex-review-pr https://github.com/OWNER/REPO/pull/NUMBER\n' >&2
    return 2
  fi
  local review_root="${CODEX_REVIEW_PLUGIN_ROOT:-}"
  if [[ -z "$review_root" ]]; then
    review_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P) || return
  fi
  # Node cannot see shell aliases. Resolve authentication through the user's gh
  # command, then scope the token to preparation without changing the shell env.
  local review_token
  review_token=$(gh auth token --hostname github.com) || return 1
  local review_args_file review_checkout review_context
  review_args_file=$(mktemp) || return
  if ! GH_TOKEN="$review_token" node "$review_root/codex/bin/prepare.mjs" "$1" > "$review_args_file"; then
    rm -f "$review_args_file"
    return 1
  fi
  unset review_token
  if ! {
    IFS= read -r -d '' review_checkout &&
    IFS= read -r -d '' review_context
  } < "$review_args_file"; then
    rm -f "$review_args_file"
    printf 'Preparation returned incomplete launch arguments.\n' >&2
    return 1
  fi
  rm -f "$review_args_file"
  codex --cd "$review_checkout" \
    "Use \$review-pr from $review_root/codex/skills/review-pr/SKILL.md with context file $review_context. Run analysis now, present the board, then discuss it with me."
}
