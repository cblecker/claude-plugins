// Parse the JSON object a model returned, tolerating a code fence or
// surrounding prose; null when no object parses.
export function parseModelJson(text: string): unknown | null {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  for (const candidate of [t, t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)]) {
    try { return JSON.parse(candidate) } catch {}
  }
  return null
}
