// Decides whether a Bash command is safe to auto-allow for a review lens agent:
// read-only git (optionally piped through head/tail), nothing else. The PR under
// review is untrusted text that may steer the agent, so this is a whitelist over
// the words the shell would actually produce, not a blacklist over the raw text.
//
// Anything the parser does not fully understand (expansions, globs, redirection,
// subshells, background jobs, backslashes, control characters, unterminated
// quotes) refuses the whole command; the caller then falls back to Claude Code's
// own permission decision, so a refusal costs a prompt, never a denial.

const GIT_SUBCOMMANDS = new Set(['rev-parse', 'diff', 'log', 'show', 'blame', 'merge-base', 'rev-list', 'status'])
// Characters that are inert outside quotes: no expansion, no operator, and no way
// to start an option a quoted form could not. `~` appears in revisions (`HEAD~3`).
// `^` is left out: under zsh's EXTENDED_GLOB it is a glob, and a committed file named
// `--output=x` would then expand into an option; quote it (`'HEAD^'`) instead.
const PLAIN = /[A-Za-z0-9_@%+=:,./~-]/
const CONTROL = /[\x00-\x08\x0a-\x1f\x7f]/

// Splits the command into `&&` / `||` / `;` / `|` separated segments of words, with
// quotes removed the way the shell removes them. null = refuse.
function parse(cmd: string): string[][] | null {
  const segments: string[][] = []
  let words: string[] = []
  let word: string | null = null // null: no word open ('' stays distinct, for `""`)
  const endWord = () => { if (word !== null) { words.push(word); word = null } }
  const endSegment = (): boolean => {
    endWord()
    if (words.length === 0) return false
    segments.push(words)
    words = []
    return true
  }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!
    if (c === "'" || c === '"') {
      const end = cmd.indexOf(c, i + 1)
      if (end < 0) return null
      const body = cmd.slice(i + 1, end)
      if (c === '"' && /[$`\\]/.test(body)) return null // expansions live inside double quotes
      word = (word ?? '') + body
      i = end
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else if (c === ';') {
      if (!endSegment()) return null
    } else if (c === '&' || c === '|') {
      if (cmd[i + 1] === c) i++ // `&&`, `||`
      else if (c === '&') return null // a lone `&` backgrounds the left side
      if (!endSegment()) return null
    } else if (PLAIN.test(c)) {
      word = (word ?? '') + c
    } else {
      return null
    }
  }
  return endSegment() ? segments : null
}

// Long options that write a file, read one from outside the checkout, run another
// program or open a viewer. Git accepts unambiguous abbreviations, so a prefix of
// one (`--cont` for `--contents`) is refused too, and so is anything that extends it.
const REFUSED_LONG = ['--output', '--no-index', '--contents', '--orderfile', '--ignore-revs-file', '--show-signature', '--help']

// Words that name something outside the checkout, directly or through the shell:
// an absolute or `~` path, a zsh `=cmd`, the same behind `--opt=` or a bundled `-xX`
// short option, or any `..` path segment (revision ranges like `a..b` stay allowed).
const OUTSIDE = [/^[=/~]/, /=[/~]/, /^-[A-Za-z0-9]*[/~]/, /(^|\/)\.\.(\/|$)|\.\.\//]

function refusedArg(arg: string, sub: string): boolean {
  if (OUTSIDE.some((re) => re.test(arg))) return true
  if (arg.includes('%G')) return true // %G? and friends run gpg over the commit's signature
  if (arg.startsWith('--')) {
    const name = arg.split('=')[0]!
    return REFUSED_LONG.some((full) => name.startsWith(full) || (name.length >= 3 && full.startsWith(name)))
  }
  if (arg === '-h' || /^-[^-]*O/.test(arg)) return true // usage viewer; -O<orderfile>, also bundled (-pO...)
  return sub === 'blame' && arg.startsWith('-S') // -S <revs-file>: a file's lines echo in the errors
}

function isReadOnlyGit(words: string[]): boolean {
  let i = 1
  for (;;) {
    if (words[i] === '--literal-pathspecs') i += 1
    else if (words[i] === '-c' && words[i + 1] === 'core.quotePath=false') i += 2
    else break
  }
  const sub = words[i]
  return sub !== undefined && GIT_SUBCOMMANDS.has(sub) && !words.slice(i + 1).some((arg) => refusedArg(arg, sub))
}

// `-N`, `-nN`, `-n N`: always with the dash, since a bare number would name a file.
function isHeadTail(args: string[]): boolean {
  if (args.length === 1) return /^-(?:n-?)?\d+$/.test(args[0]!)
  return args.length === 2 && args[0] === '-n' && /^-?\d+$/.test(args[1]!)
}

export function isReadOnlyCommand(command: string): boolean {
  const cmd = String(command || '').trim()
  if (!cmd || CONTROL.test(cmd)) return false
  const segments = parse(cmd)
  if (!segments) return false
  return segments.every((words) => {
    const [program, ...args] = words
    if (program === 'git') return isReadOnlyGit(words)
    if (program === 'head' || program === 'tail') return isHeadTail(args)
    return false
  })
}

export type ToolCheckResult = { decision: 'allow' | 'ask' | 'deny'; reason?: string; rule?: string }

// The Bash arguments that do not change what runs. Anything else (a sandbox override,
// extra network hosts, ...) widens what the command may do, so the call is not ours to allow.
const SAFE_INPUT_KEYS = new Set(['command', 'description', 'timeout', 'run_in_background'])

// The `tool.check` verdict for a lens agent's Bash call. Only Claude Code's plain
// default `ask` is upgraded to `allow`; a deny, an ask that a settings rule asked for,
// and an already-allowed call come back untouched.
export function shouldAutoAllow(input: unknown, core: ToolCheckResult): ToolCheckResult {
  if (core.decision !== 'ask' || core.rule) return core
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return core
  if (!Reflect.ownKeys(input).every((key) => typeof key === 'string' && SAFE_INPUT_KEYS.has(key))) return core
  const command = (input as { command?: unknown }).command
  if (typeof command !== 'string' || !isReadOnlyCommand(command)) return core
  return { decision: 'allow', reason: 'pr-review-toolkit: read-only git for a review lens' }
}
