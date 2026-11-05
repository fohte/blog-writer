import type { EditorView } from '@codemirror/view'
import type * as Y from 'yjs'

import { diff } from '#editor/text-diff'

export function replaceBody(
  view: EditorView,
  undoManager: Y.UndoManager,
  next: string,
): void {
  const previous = view.state.doc.toString()
  if (previous === next) return

  const changes = diff(previous, next)
  if (changes.length === 0) return

  undoManager.stopCapturing()
  view.dispatch({ changes })
  undoManager.stopCapturing()
}
