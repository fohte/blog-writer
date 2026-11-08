import type { EditorView } from '@codemirror/view'

import type { MoveBlockInput } from '#article/index'
import { deriveHeadingTree, flattenHeadingTree } from '#article/index'
import type { OutlineHeadingActionsProps } from '#components/outline-heading-actions'
import { adjacentMove, headingChildMove } from '#outline/block-ranges'
import {
  applyHeadingChange,
  deleteHeadingChange,
  outdentHeadingMove,
} from '#outline/heading-edits'
import type { MoveHistory } from '#outline/move-history'

// The outline shows history failures through `history.onError`.
const ignore = () => undefined

export function outlineHeadingActions({
  history,
  selectedFrom,
  view,
}: {
  history: MoveHistory
  selectedFrom: number | undefined
  view: EditorView
}): OutlineHeadingActionsProps {
  const onUndo = () => {
    history.undo(view).match(ignore, ignore)
  }
  const markdown = view.state.doc.toString()
  const tree = deriveHeadingTree(markdown)
  const heading = flattenHeadingTree(tree).find(
    ({ from }) => from === selectedFrom,
  )
  if (!heading) return { onUndo }

  const moveAction = (input: MoveBlockInput | undefined) =>
    input
      ? () => {
          history.move(input, view).match(ignore, ignore)
        }
      : undefined

  return {
    onDelete: () => {
      applyHeadingChange(view, deleteHeadingChange(markdown, heading))
    },
    onIndent: moveAction(headingChildMove(view.state, heading.from)),
    onMoveDown: moveAction(adjacentMove(view.state, heading.from, 'down')),
    onMoveUp: moveAction(adjacentMove(view.state, heading.from, 'up')),
    onOutdent: moveAction(outdentHeadingMove(markdown, tree, heading)),
    onUndo,
  }
}
