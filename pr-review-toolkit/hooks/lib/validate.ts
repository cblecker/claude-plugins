const SEVERITIES = ['critical', 'important', 'suggestion']
const STATUSES = ['addressed', 'partial', 'not_addressed', 'unverifiable']
const REQUIRED = ['location', 'severity', 'confidence', 'title', 'claim', 'evidence', 'whyItMatters']

export function validateFindings(input: any): string[] {
  const errors: string[] = []
  if (!Array.isArray(input?.findings)) errors.push('findings must be an array')
  if (!Array.isArray(input?.positiveObservations)) errors.push('positiveObservations must be an array of strings')
  ;(Array.isArray(input?.findings) ? input.findings : []).forEach((f: any, i: number) => {
    for (const k of REQUIRED) if (f == null || f[k] == null || f[k] === '') errors.push(`findings[${i}].${k} is required`)
    if (f && f.severity != null && !SEVERITIES.includes(f.severity)) errors.push(`findings[${i}].severity must be critical|important|suggestion`)
    if (f && f.confidence != null && (typeof f.confidence !== 'number' || f.confidence < 0 || f.confidence > 100)) errors.push(`findings[${i}].confidence must be a number 0-100`)
    if (f && f.location != null && typeof f.location.path !== 'string') errors.push(`findings[${i}].location.path is required`)
  })
  return errors
}

export function validateVerdicts(input: any): string[] {
  const errors: string[] = []
  if (!Array.isArray(input?.items)) return ['items must be an array']
  input.items.forEach((v: any, i: number) => {
    for (const k of ['ask', 'status', 'evidence']) if (v == null || v[k] == null || v[k] === '') errors.push(`items[${i}].${k} is required`)
    if (v && v.status != null && !STATUSES.includes(v.status)) errors.push(`items[${i}].status must be addressed|partial|not_addressed|unverifiable`)
  })
  return errors
}
