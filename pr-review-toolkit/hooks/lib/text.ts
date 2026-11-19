// Review text as the pane draws it and posting sends it. Surfaces refuse a whole tree
// over a stray control character (a Text or Markdown takes tab and newline only), and PR
// text routinely carries \r\n. Bidirectional controls go too, so review text cannot
// reorder what the pane shows; line and paragraph separators become newlines. Drafts are
// stored through it (drafting.ts cleanDrafts), so the preview and the post are the same
// text. Idempotent: what one pass leaves holds no \r, control or bidi character.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g
const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g
export function clean(value: unknown): string {
  return String(value ?? '').replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(CONTROL, ' ').replace(BIDI, '')
}
