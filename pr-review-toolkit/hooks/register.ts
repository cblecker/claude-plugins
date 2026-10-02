import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { RunState } from './lib/types'
import { applyDeposit } from './lib/deposit'
import { shouldAutoAllow } from './lib/bash-guard'

// `$` never crosses a file import: read/update need an atom declared in the same
// file as the hooks that use them, so each hooks file declares its own.
const runAtom = atom({ plugin: 'pr-review-toolkit', key: 'run' }, null as RunState | null)
async function getRun($: Parameters<typeof read>[0]): Promise<RunState | null> { return read($, runAtom) }
async function setRun($: Parameters<typeof update>[0], fn: (r: RunState | null) => RunState | null) { await update($, runAtom, fn) }

// tool_use_ids of in-flight Bash calls made by a subagent during an active run.
// Module state, lost on reload; every entry is removed when its call returns.
const lensBash = new Set<string>()

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'submit_findings',
      description: 'Internal to review-pr: a review lens agent reports its findings here. Not for the main conversation.',
      inputSchema: { type: 'object', required: ['run', 'lens', 'findings', 'positiveObservations'], properties: {
        run: { type: 'string' }, lens: { type: 'string' },
        findings: { type: 'array', items: { type: 'object' } },
        positiveObservations: { type: 'array', items: { type: 'string' } } } },
    })
    await $.tool.register({
      name: 'submit_followup',
      description: 'Internal to review-pr: the follow-up verifier reports its verdicts here. Not for the main conversation.',
      inputSchema: { type: 'object', required: ['run', 'items'], properties: { run: { type: 'string' }, items: { type: 'array', items: { type: 'object' } } } },
    })
    return next(e)
  })

  // The deposit tools answer themselves: validate against the run's nonce and
  // selected lenses, store by lens, and tell the agent whether it was accepted.
  on('tool.call', { tool: 'mcp__pr-review-toolkit__submit_findings' }, async ($, e) => {
    let answer = 'rejected: unknown run'
    await setRun($, (r) => { const out = applyDeposit(r, e, 'findings'); answer = out.answer; return out.run })
    return { result: answer }
  })
  on('tool.call', { tool: 'mcp__pr-review-toolkit__submit_followup' }, async ($, e) => {
    let answer = 'rejected: unknown run'
    await setRun($, (r) => { const out = applyDeposit(r, e, 'followup'); answer = out.answer; return out.run })
    return { result: answer }
  })

  // Lens agents run read-only git constantly; auto-allow exactly that and leave every
  // other Bash call to Claude Code's own decision. `tool.check` fires inside the
  // `tool.call` hook's `next(e)`, so a call is remembered only while it is in flight,
  // and only when a subagent makes it during an active run (`agentId` is absent on
  // the main loop; it cannot tell a lens from any other subagent).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!e.agentId) return next(e)
    const run = await getRun($)
    if (run && run.phase === 'progress' && run.taskId) lensBash.add(e.tool_use_id)
    try { return await next(e) } finally { lensBash.delete(e.tool_use_id) }
  })
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const core = await next(e)
    return e.tool_use_id && lensBash.has(e.tool_use_id) ? shouldAutoAllow(e.input, core) : core
  })
}
