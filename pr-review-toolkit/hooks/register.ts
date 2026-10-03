import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, Register, UiOpenResult } from 'claude-code'
import type { RunState } from './lib/types'
import type { Io } from './lib/io'
import { applyDeposit } from './lib/deposit'
import { claimNotice, failSynthesis, finishable, rewriteNotice, withOutcome } from './lib/completion'
import { shouldAutoAllow } from './lib/bash-guard'
import { git } from './lib/git'
import { prepareReview } from './lib/prepare'
import { synthesize } from './lib/synthesis'
import { buildBoard } from './lib/board'
import { acceptDrafts, cleanDrafts, draftsRejection, NO_BOARD } from './lib/drafting'
import { buildPlan } from './lib/posting'
import { cleanupPlan, interruptedSynthesis, launched, recoverPosting } from './lib/cleanup'
import { inFlightError, launchedTaskId, launchFieldsError, launchGate } from './lib/launch'
import type { LaunchGate } from './lib/launch'
import { registerPane } from './pane'
import { PANE_ID } from './lib/pane'

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

// Synthesis and the board, run detached once a completed notice has claimed the run
// (`synthesizing`). The run is read once: its deposits, threads, follow-up and verdicts
// are final when the workflow has completed. Synthesis can take minutes, so the board
// is written only onto the run it was started for, still synthesizing (a cancel clears
// that flag, a newer run has another taskId). A throw reaches failRun.
async function finishRun($: EngineInterface, taskId: string) {
  const claimed = await getRun($)
  if (!finishable(claimed, taskId)) { $.ui.log('review finish skipped: run no longer finishable', { to: 'debug' }); return }
  const run = withOutcome(claimed)
  const out = await synthesize(makeIo($), run)
  if (out.reason) $.ui.log(`review synthesis failed, findings listed unmerged: ${out.reason}`, { to: 'debug' })
  const board = buildBoard(run, out)
  let written = false as boolean
  await setRun($, (r) => {
    if (!finishable(r, taskId)) return r
    written = true
    // The board's recommendations start selected, as the pre-3.0 "Draft recommended findings".
    return { ...r, failedLenses: run.failedLenses, verifierFailed: run.verifierFailed, board, phase: 'board', synthesizing: false, selected: board.recommendedToPost.map((i) => i.id) }
  })
  if (!written) { $.ui.log('review board dropped: run no longer finishable', { to: 'debug' }); return }
  // The completed notice says the board is opening there; the person may have closed the pane.
  await openPane($, false)
}

// The review pane (pane.tsx draws it). Only the person's own /review-board gives it the
// keys (R46): a pane holding the keys presses its buttons' hotkeys, and an unasked open
// must never turn typing meant for the prompt into board actions. An unasked open that
// waits undrawn (a narrow terminal) says how to open it. Answers the open's result, or
// null when it failed; a failure leaves the tool's or command's own answer as it was.
async function openPane($: EngineInterface, asked: boolean): Promise<UiOpenResult | null> {
  try {
    const opened = await $.ui.open({ id: PANE_ID, title: 'PR review', ...(asked ? { focus: true as const } : {}) })
    if (!opened.isPlaced && !asked) $.ui.toast('PR review: run /review-board to open the review pane')
    return opened
  } catch (err) {
    $.ui.log(`review pane not opened: ${String(err)}`, { to: 'debug' })
    return null
  }
}

// Stops the review workflow, never awaited: a session end has 1.5 s for every hook, and a
// call can wait while Claude is working. A stop that fails (the task already ended) changes
// nothing, since the run is reset or cancelled either way; it is logged for the debug log.
function stopTask($: EngineInterface, taskId: string) {
  void $.tool.call({ tool: 'TaskStop', task_id: taskId }).catch((err) => $.ui.log(`review workflow ${taskId} not stopped: ${String(err)}`, { to: 'debug' }))
}

// Synthesis and the board, started detached for a run a completed notice claimed. A throw
// (or a board that cannot be built) fails the run it was started for.
function startFinish($: EngineInterface, taskId: string) {
  void finishRun($, taskId).catch((err) => {
    $.ui.log(`review finish failed: ${String(err)}`, { to: 'debug' })
    return failRun($, taskId, err)
  })
}

async function failRun($: EngineInterface, taskId: string, err: unknown) {
  const why = err instanceof Error ? err.message : String(err)
  try { await setRun($, (r) => failSynthesis(r, taskId, why)) } catch (e) { $.ui.log(`review board failure not recorded: ${String(e)}`, { to: 'debug' }) }
}

// The workflow's completion notice: the text that replaces it (our notice as one line,
// any other text kept), or null to pass it through. A notice for our taskId is always
// rewritten, so no workflow result reaches the transcript, but only the first one for a
// run still in progress advances the run: a duplicate is rewritten and changes nothing.
// Synthesis runs detached (it can take minutes), so the rewritten notice is delivered
// at once.
async function onNotice($: EngineInterface, text: string): Promise<string | null> {
  const run = await getRun($)
  const hit = rewriteNotice(text, run)
  const taskId = run?.taskId
  if (!hit || !taskId) return null
  let claimed = false as boolean
  await setRun($, (cur) => { const c = claimNotice(cur, taskId, hit.ok, hit.status); claimed = c.claimed; return c.run })
  if (claimed && hit.ok) startFinish($, taskId)
  return hit.text
}

// A hook that throws must still hand the notice on, so nothing here can fail the chain.
async function noticeText($: EngineInterface, text: string): Promise<string | null> {
  try { return await onNotice($, text) } catch (err) { $.ui.log(`completion notice not rewritten: ${String(err)}`, { to: 'debug' }); return null }
}

// tool_use_ids of in-flight Bash calls made by a subagent during an active run.
// Module state, lost on reload; every entry is removed when its call returns.
const lensBash = new Set<string>()

export const register: Register = (on) => {
  registerPane(on)
  // A reload runs session.start again and loses the module variables a post and a
  // synthesis ran in. A run found posting has no live post: it ends as interrupted (R44),
  // whatever the post wrote. A run found synthesizing has lost its board: its deposits are
  // in the state, so the synthesis is started again (nothing is lost; a second synthesis
  // that finds the board written writes nothing). A state failure here must not keep the
  // tools from registering.
  on('session.start', async ($, e, next) => {
    try {
      let resume = null as string | null
      await setRun($, (r) => { resume = interruptedSynthesis(r); return recoverPosting(r) })
      if (resume) startFinish($, resume)
    } catch (err) {
      $.ui.log(`review run not recovered: ${String(err)}`, { to: 'debug' })
    }
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
    await $.tool.register({
      name: 'set_drafts',
      description: 'Internal to review-pr: Claude submits the drafted review comments for the items selected in the review pane, only when the pane asks for drafts. Pass every draft in one call; a later call replaces the earlier drafts.',
      inputSchema: { type: 'object', required: ['drafts'], properties: { drafts: { type: 'array', items: {
        type: 'object', properties: {
          id: { type: 'string' }, kind: { type: 'string' },
          path: { type: 'string' }, line: { type: 'integer' }, commentId: { type: 'integer' }, body: { type: 'string' },
          alsoCovers: { type: 'array', items: { type: 'string' } } } } } } },
    })
    await $.command.register({ name: 'review-board', description: 'Open the PR review pane', immediate: true })
    return next(e)
  })

  // The session ends (/clear, /resume, exit): drop the run, so the next conversation starts
  // clean (a /clear fires no session.start), and stop the workflow of a run that was in
  // progress. The run is read and dropped in one state operation, so nothing can skip the
  // reset. Every hook shares one 1.5 s bound, so the stop is not awaited, and nothing here
  // may keep `next` from running.
  on('session.end', async ($, e, next) => {
    let stop = null as string | null
    try {
      await setRun($, (r) => { stop = cleanupPlan(r).stop; return null })
    } catch (err) {
      $.ui.log(`review run not cleaned up: ${String(err)}`, { to: 'debug' })
    }
    if (stop) stopTask($, stop)
    return next(e)
  })

  on('command.run', { command: 'review-board' }, async ($) => {
    const opened = await openPane($, true)
    return opened && !opened.isPlaced ? { text: `The review pane is open but not drawn yet: ${opened.reason}` } : {}
  })

  // Prepare the review as code and store it. The in-flight check runs again at the
  // write, so a run launched while this one was being prepared is never replaced.
  on('tool.call', { tool: 'mcp__pr-review-toolkit__prepare_review' }, async ($) => {
    const out = await prepareReview(makeIo($), await getRun($))
    if ('error' in out) return { result: JSON.stringify({ error: out.error }) }
    let clash = null as string | null
    await setRun($, (cur) => { clash = inFlightError(cur); return clash ? cur : out.run })
    if (!clash) await openPane($, false)
    return { result: JSON.stringify(clash ? { error: clash } : { handle: out.run.handle }) }
  })

  // The analysis workflow launches only from a fresh preparation, and by name only (a
  // script, scriptPath or resumeFromRunId would take the injected payload elsewhere): the
  // gate runs inside the state update, so two launches cannot both claim one preparation.
  // The nonce is stored before the workflow starts (its agents may deposit at once); the
  // taskId follows. A launch that did not start (a deny, an error result, a result with
  // an error, a call that threw) gives the nonce back; a throw is answered as a deny
  // naming why, since a hook that throws shows the person a failed-hook warning instead.
  on('tool.call', { tool: 'Workflow', name: WORKFLOW }, async ($, e, next) => {
    const byName = launchFieldsError(e)
    if (byName) return { deny: byName }
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
    // Never rejects: a release that fails leaves a nonce prepare_review can replace.
    const release = async () => {
      try { await setRun($, (cur) => (cur && cur.run === nonce && !cur.taskId ? withoutNonce(cur) : cur)) } catch (err) { $.ui.log(`review launch not released: ${String(err)}`, { to: 'debug' }) }
    }
    let r
    try {
      r = await next({ ...e, args: gate.args })
    } catch (err) {
      await release()
      return { deny: `The review workflow did not start: ${err instanceof Error ? err.message : String(err)}` }
    }
    const taskId = launchedTaskId(r)
    if (taskId) {
      // A run cancelled while the launch was under way keeps its phase; the workflow that
      // started anyway is stopped.
      let stop = false
      await setRun($, (cur) => { const l = launched(cur, nonce, taskId); stop = l.stop; return l.run })
      if (stop) stopTask($, taskId)
    } else await release()
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

  // The drafts Claude writes for the selected items. A call that would be refused is
  // answered before any git runs. Accepting fixes the posting plan (what the preview
  // shows and posting sends): its anchors are checked against the PR diff first, then
  // the drafts and plan are stored inside the state update, which checks again, so a
  // phase that changed meanwhile (posting, done) or another run is respected.
  on('tool.call', { tool: 'mcp__pr-review-toolkit__set_drafts' }, async ($, e) => {
    const run = await getRun($)
    const rejected = draftsRejection(run, e.drafts)
    if (rejected || !run) return { result: rejected ?? NO_BOARD }
    const plan = await buildPlan(makeIo($), run, cleanDrafts(e.drafts as unknown[]))
    let answer = NO_BOARD
    await setRun($, (r) => { const out = acceptDrafts(r, e.drafts, plan); answer = out.answer; return out.run })
    return { result: answer }
  })

  // The workflow's completion reaches the main conversation as a `queued_command`
  // attachment while Claude is mid-turn, or as a `prompt.submit` of origin
  // `task-notification` when idle (a stopped workflow sends none). Match only the
  // `queued_command` attachment (an `edited_text_file` can quote a taskId). Every
  // answer goes through `next`: a `prompt.submit` answered without it, or dropped,
  // prints a transcript warning.
  on('prompt.attachment', { type: 'queued_command' }, async ($, e, next) => {
    const text = await noticeText($, e.text)
    return next(text === null ? e : { ...e, text })
  })
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind !== 'task-notification') return next(e)
    const text = await noticeText($, e.text)
    return next(text === null ? e : { ...e, text })
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
