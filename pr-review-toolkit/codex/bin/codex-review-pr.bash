# Source after the user's gh and codex aliases have been defined.
codex-review-pr() (
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
  local review_source review_context
  review_context=$(GH_TOKEN="$review_token" node "$review_root/codex/bin/prepare.mjs" "$1") || return 1
  unset review_token
  review_source=$(printf '%s' "$review_context" | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const context = JSON.parse(input);
      if (context.version !== 2 || typeof context.sourceCheckout !== "string" || !context.sourceCheckout)
        throw Error("Preparation returned invalid launch context");
      // Preserve even a trailing newline in the checkout path across Bash substitution.
      process.stdout.write(context.sourceCheckout + ".");
    });
  ') || return 1
  review_source=${review_source%.}
  codex --enable worktrees --worktree --cd "$review_source" \
    "Use \$review-pr from $review_root/codex/skills/review-pr/SKILL.md with this launcher context JSON: $review_context
Run analysis now, present the board, then discuss it with me."
)
