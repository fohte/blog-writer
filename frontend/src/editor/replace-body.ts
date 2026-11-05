import type { EditorView } from '@codemirror/view'
import type * as Y from 'yjs'

function replaceRange(previous: string, next: string) {
  let prefix = 0
  while (
    prefix < previous.length &&
    prefix < next.length &&
    previous[prefix] === next[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) {
    suffix += 1
  }

  while (
    prefix > 0 &&
    (isLowSurrogate(previous.charCodeAt(prefix)) ||
      isLowSurrogate(next.charCodeAt(prefix)))
  ) {
    prefix -= 1
  }

  if (
    suffix > 0 &&
    (isLowSurrogate(previous.charCodeAt(previous.length - suffix)) ||
      isLowSurrogate(next.charCodeAt(next.length - suffix)))
  ) {
    suffix -= 1
  }

  const from = prefix
  const to = previous.length - suffix
  const insertTo = next.length - suffix

  return { from, to, insert: next.slice(from, insertTo) }
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

export function replaceBody(
  view: EditorView,
  undoManager: Y.UndoManager,
  next: string,
): void {
  const previous = view.state.doc.toString()
  if (previous === next) return

  const change = replaceRange(previous, next)
  undoManager.stopCapturing()
  view.dispatch({ changes: change })
  undoManager.stopCapturing()
}
