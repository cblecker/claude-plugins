import type { Io } from './io'
import { ROSTER, LENS_NAMES, lensEffort } from './roster'
import type { Effort } from './roster'
import { parseModelJson } from './json'

export type LensPick = { name: string; effort: Effort; rationale: string }
export type DiffShape = { fileCount: number; additions: number; deletions: number; notableAreas: string[] }
export type Selection = { lenses: LensPick[]; shape: DiffShape | null }
export type DiffSummary = { nameStatus: string; numstat: string; shortstat: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// A finite, non-negative count from a number or numeric string; null otherwise.
function count(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

// Read a lens selection out of the model's reply: known lenses only, each once,
// code-reviewer always present and first. Null when the reply is not an object
// with a `lenses` array holding at least one known lens.
export function parseSelection(text: string): Selection | null {
  const j = parseModelJson(text)
  if (!isRecord(j) || !Array.isArray(j.lenses)) return null
  const seen = new Set<string>()
  const lenses: LensPick[] = []
  for (const l of j.lenses as unknown[]) {
    if (!isRecord(l) || typeof l.name !== 'string' || !LENS_NAMES.includes(l.name) || seen.has(l.name)) continue
    seen.add(l.name)
    lenses.push({ name: l.name, effort: lensEffort(l.name), rationale: String(l.rationale || '') })
  }
  if (!lenses.length) return null
  if (!seen.has('code-reviewer')) lenses.unshift({ name: 'code-reviewer', effort: 'high', rationale: 'General correctness always runs.' })
  else lenses.sort((a, b) => (a.name === 'code-reviewer' ? -1 : b.name === 'code-reviewer' ? 1 : 0))
  const s = j.shape
  const fileCount = isRecord(s) ? count(s.fileCount) : null
  const shape: DiffShape | null = isRecord(s) && fileCount !== null
    ? { fileCount, additions: count(s.additions) ?? 0, deletions: count(s.deletions) ?? 0, notableAreas: Array.isArray(s.notableAreas) ? s.notableAreas.map(String) : [] }
    : null
  return { lenses, shape }
}

// Every roster lens, no shape: what a failed selection runs.
export function fallbackSelection(): Selection {
  return { lenses: ROSTER.map((l) => ({ name: l.name, effort: l.effort, rationale: '' })), shape: null }
}

// Ask a model which lenses the diff needs. Any failure (a throw, no answer, an
// unparseable or empty answer) runs every lens instead.
export async function selectLenses(io: Io, diff: DiffSummary): Promise<Selection & { source: 'selector' | 'all-lenses-fallback' }> {
  const prompt = '## Changed files (name-status)\n' + diff.nameStatus.slice(0, 20000) +
    '\n## Per-file churn (numstat)\n' + diff.numstat.slice(0, 20000) + '\n## Shortstat\n' + diff.shortstat +
    '\n## Available lenses\n' + ROSTER.map((l) => `- ${l.name}: ${l.runsWhen}`).join('\n') +
    '\n## Rules\n- Be liberal: when in doubt, include the lens.\n- code-reviewer always runs.\n- One-line rationale per selected lens, grounded in the file list.\n' +
    '- Report shape: fileCount, additions, deletions from shortstat (0 when absent); notableAreas = paths or subsystems with the highest review signal.\n' +
    'Reply with ONLY a JSON object: {"lenses":[{"name":string,"rationale":string}],"shape":{"fileCount":number,"additions":number,"deletions":number,"notableAreas":[string]}}'
  try {
    const r = await io.complete({ model: 'sonnet', system: 'You select code review lenses for a pull request. Output JSON only.', prompt, maxTokens: 4000, effort: 'medium', timeoutMs: 180000 })
    const parsed = r.isAnswered ? parseSelection(r.text) : null
    if (parsed) return { ...parsed, source: 'selector' }
  } catch {}
  return { ...fallbackSelection(), source: 'all-lenses-fallback' }
}
