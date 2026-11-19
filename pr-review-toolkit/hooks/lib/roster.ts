export type Effort = 'low' | 'medium' | 'high'
export type RosterLens = { name: string; runsWhen: string; effort: Effort }
export const ROSTER: readonly RosterLens[] = [
  { name: 'code-reviewer', runsWhen: 'Always — general code correctness, maintainability, and guideline adherence.', effort: 'high' },
  { name: 'silent-failure-hunter', runsWhen: 'Changes touch error handling, try/catch, retries, or fallback logic.', effort: 'high' },
  { name: 'pr-test-analyzer', runsWhen: 'Functional code changed that should have corresponding tests.', effort: 'high' },
  { name: 'comment-analyzer', runsWhen: 'Changes touch docs files, or add or modify comments or docstrings.', effort: 'medium' },
  { name: 'type-design-analyzer', runsWhen: 'Changes introduce or modify type definitions in typed languages.', effort: 'high' },
  { name: 'security-reviewer', runsWhen: 'Changes touch auth, crypto, tokens, credentials, input handling at trust boundaries, or other security-sensitive code.', effort: 'high' },
  { name: 'api-compat-reviewer', runsWhen: 'Changes touch public APIs, exports, schemas, or client-facing interfaces.', effort: 'high' },
  { name: 'concurrency-reviewer', runsWhen: 'Changes touch mutexes, locks, channels, goroutines, async, or parallel code.', effort: 'high' },
]
export const LENS_NAMES = ROSTER.map((l) => l.name)
export function lensEffort(name: string): Effort {
  return ROSTER.find((l) => l.name === name)?.effort ?? 'high'
}
