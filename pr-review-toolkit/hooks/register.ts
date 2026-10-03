import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, Register } from 'claude-code'
import type { RunState } from './lib/types'
import type { Io } from './lib/io'
import { applyDeposit } from './lib/deposit'
import { shouldAutoAllow } from './lib/bash-guard'
import { git } from './lib/git'
import { prepareReview } from './lib/prepare'
import { inFlightError, launchGate } from './lib/launch'
import type { LaunchGate } from './lib/launch'

const WORKFLOW = 'pr-review-toolkit:review-pr-analysis'

// `$` never crosses a file import: read/update need an atom declared in the same
// file as the hooks that use them, so each hooks file declares its own.
const runAtom = atom({ plugin: 'pr-review-toolkit', key: 'run' }, null as RunState | null)
async function getRun($: Parameters<typeof read>[0]): Promise<RunState | null> { return read($, runAtom) }
async function setRun($: Parameters<typeof update>[0], fn: (r: RunState | null) => RunState | null) { await update($, runAtom, fn) }

// The lib's I/O, spelled with this hook's `$` (lib files never see `$`). GitHub
// calls go to the github plugin's MCP server.
function makeIo($: EngineInterface): Io {
  return {
    run: async (argv, opts) => {
      const r = await $.process.run(argv, opts)
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, truncated: r.isStdoutTruncated }
    },
    mcp: (tool, args) => $.mcp.call('plugin:github:github', tool, args),
    complete: async (req) => {
      const r = await $.model.complete({ ...req, effort: req.effort as ModelEffort | undefined })
      return { isAnswered: r.isAnswered, text: r.isAnswered ? r.text : '' }
    },
  }
}

// The run without its launch nonce: a launch that did not start gives the nonce back.
function withoutNonce(r: RunState): RunState {
  const { run: _nonce, ...rest } = r
  return rest
}

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
    await $.tool.register({
      name: 'prepare_review',
      description: 'Prepare a PR review of the current checkout: resolves the PR, collects review data, selects review lenses. Returns { handle } to pass as args.pr to the review-pr-analysis Workflow, or { error } to report verbatim.',
      inputSchema: { type: 'object', properties: {} },
    })
    return next(e)
  })

  // Prepare the review as code and store it. The in-flight check runs again at the
  // write, so a run launched while this one was being prepared is never replaced.
  on('tool.call', { tool: 'mcp__pr-review-toolkit__prepare_review' }, async ($) => {
    const out = await prepareReview(makeIo($), await getRun($))
    if ('error' in out) return { result: JSON.stringify({ error: out.error }) }
    let clash = null as string | null
    await setRun($, (cur) => { clash = inFlightError(cur); return clash ? cur : out.run })
    return { result: JSON.stringify(clash ? { error: clash } : { handle: out.run.handle }) }
  })

  // The analysis workflow launches only from a fresh preparation: the gate runs
  // inside the state update, so two launches cannot both claim one preparation.
  // The nonce is stored before the workflow starts (its agents may deposit at
  // once); the taskId follows, and a launch that did not start gives the nonce back.
  on('tool.call', { tool: 'Workflow', name: WORKFLOW }, async ($, e, next) => {
    const run = await getRun($)
    let head = ''
    if (run) { try { head = (await git(makeIo($), ['rev-parse', 'HEAD'], run.checkoutPath)).trim() } catch {} }
    const now = await $.clock.now()
    let gate = { deny: '' } as LaunchGate
    await setRun($, (cur) => {
      gate = launchGate(cur, e.args, head, now)
      return !cur || 'deny' in gate ? cur : { ...cur, run: gate.nonce, deposits: {}, verdicts: null }
    })
    if ('deny' in gate) return { deny: gate.deny }
    const nonce = gate.nonce
    const release = () => setRun($, (cur) => (cur && cur.run === nonce && !cur.taskId ? withoutNonce(cur) : cur))
    let r
    try { r = await next({ ...e, args: gate.args }) } catch (err) { await release(); throw err }
    const taskId = r.deny === undefined ? (r.result as { taskId?: unknown } | undefined)?.taskId : undefined
    if (typeof taskId === 'string' && taskId) await setRun($, (cur) => (cur && cur.run === nonce ? { ...cur, taskId, phase: 'progress' } : cur))
    else await release()
    return r
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
