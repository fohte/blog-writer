import { isolateHistory } from '@codemirror/commands'
import { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import { diff } from '#editor/text-diff'

export function replaceBody(view: EditorView, next: string): void {
  const previous = view.state.doc.toString()
  if (previous === next) return

  const changes = diff(previous, next)
  if (changes.length === 0) return

  view.dispatch({
    changes,
    annotations: [
      isolateHistory.of('full'),
      Transaction.userEvent.of('input.replace'),
    ],
  })
}
