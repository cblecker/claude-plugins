import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, On } from 'claude-code'
import type { RunState } from './lib/types'
import type { Io } from './lib/io'
import { applyKey, askPrompt, drawView, DRAFTING_REF, rewordPrompt, startDrafting, startReword, view } from './lib/pane'
import { draftPrompt, selectedItem } from './lib/drafting'
import { finishPosting, postReview, startPosting, submittedEvent } from './lib/posting'
import type { PostResult, ShownPreview } from './lib/posting'

// The review pane: one `Pane` (id 'pr-review') drawn from the run. lib/pane.ts builds
// the view, draws it with the surface's elements and holds the state changes; this file
// reads the run and runs what a Button or Input asks for. `$` never crosses a file
// import, so this file declares its own atom and I/O.
export { view }

const runAtom = atom({ plugin: 'pr-review-toolkit', key: 'run' }, null as RunState | null)
async function getRun($: Parameters<typeof read>[0]): Promise<RunState | null> { return read($, runAtom) }
async function setRun($: Parameters<typeof update>[0], fn: (r: RunState | null) => RunState | null) { await update($, runAtom, fn) }

// Posting needs only GitHub; the rest of Io is spelled as register.ts spells it.
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

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// A request for Claude, never awaited: `$.prompt.submit` resolves only when its turn
// starts, and Claude may be working.
function tell($: EngineInterface, text: string) {
  void $.prompt.submit({ text }).catch((err) => $.ui.log(`The review pane could not send its request to Claude: ${message(err)}`))
}

// Draft: the run moves to drafting first (set_drafts is refused in any other phase),
// then Claude is asked for drafts of the selection as it was written.
async function draft($: EngineInterface) {
  let next = null as RunState | null
  await setRun($, (r) => { next = startDrafting(r); return next ?? r })
  if (next) tell($, draftPrompt(next, $.plugin.root + DRAFTING_REF))
}

// Post exactly the preview the user saw: `shown` is the plan and event this drawing
// rendered, and startPosting refuses when the run no longer holds them (R43). The claim
// is made once; the GitHub writes run detached, as finishRun does, and always record
// their outcome so the run never stays in 'posting'. An unexpected throw may have
// posted part of the review, so it ends the run rather than offering a re-post.
async function post($: EngineInterface, shown: ShownPreview | null) {
  if (!shown) return
  let claim = null as ReturnType<typeof startPosting> | null
  await setRun($, (r) => (claim = startPosting(r, shown)).run)
  if (!claim || claim.blockers.length || !claim.run) {
    $.ui.toast(claim?.blockers[0] ?? 'Nothing to post.')
    return
  }
  const claimed = claim.run
  void send($, claimed).catch((err) => $.ui.log(`review posting not recorded: ${message(err)}`, { to: 'debug' }))
}

async function send($: EngineInterface, claimed: RunState) {
  let out: PostResult
  try {
    out = await postReview(makeIo($), claimed)
  } catch (err) {
    const error = `Posting stopped unexpectedly (${message(err)}); part of the review may have posted. Check the PR before posting again.`
    out = { posted: [], error, log: [error], finished: true }
  }
  try {
    await setRun($, (r) => finishPosting(r, claimed, out))
  } finally {
    for (const line of out.log) $.ui.log(line)
  }
}

// A Button press, by key. Draft and Post talk to Claude and GitHub; every other key
// is a state change lib/pane.ts makes on the run as it is at the write.
async function press($: EngineInterface, key: string, shown: ShownPreview | null) {
  try {
    if (key === 'draft') await draft($)
    else if (key === 'post') await post($, shown)
    // Task 16: 'cancel' (Esc) is handled here.
    else await setRun($, (r) => applyKey(r, key))
  } catch (err) {
    $.ui.log(`review pane: ${key} failed: ${message(err)}`, { to: 'debug' })
  }
}

// An Input's Enter: a question about one item, or a reword of the drafts.
async function submit($: EngineInterface, key: string, value: string) {
  const text = value.trim()
  if (!text) return
  try {
    if (key === 'reword') {
      let next = null as RunState | null
      await setRun($, (r) => { next = startReword(r); return next ?? r })
      if (next) tell($, rewordPrompt(next, text, $.plugin.root + DRAFTING_REF))
    } else if (key.startsWith('ask-')) {
      const id = key.slice('ask-'.length)
      const run = await getRun($)
      const item = run ? selectedItem(run, id) : undefined
      if (item) tell($, askPrompt(id, text, item))
    }
  } catch (err) {
    $.ui.log(`review pane: ${key} failed: ${message(err)}`, { to: 'debug' })
  }
}

export function registerPane(on: On) {
  // The id is written out: the engine reads the matcher off the source (PANE_ID).
  on('ui.render', { component: 'Pane', requestId: 'pr-review' }, async ($, e) => {
    const run = await getRun($)
    // What this drawing shows is what Post may send.
    const shown: ShownPreview | null = run?.plan ? { plan: run.plan, event: submittedEvent(run) } : null
    return drawView($.ui.resolve(e), view(run, { columns: e.props.bodyColumns, focused: e.props.isFocused }), {
      press: (key) => press($, key, shown),
      submit: (key, value) => submit($, key, value),
      // Links in review text come from the PR and the lenses: a click opens nothing.
      link: (_key, href) => $.ui.toast(`PR review: links in review text are not opened from the pane (${href.slice(0, 200)})`),
    })
  })
}
