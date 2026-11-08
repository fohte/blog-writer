import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import type { MoveBlockInput } from '#article/index'
import { deriveHeadingTree, flattenHeadingTree } from '#article/index'
import type { Heading } from '#article/types'
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

type SelectedHeading = {
  state: EditorState
  markdown: string
  tree: Heading[]
  heading: Heading
}

function selectedHeading(state: EditorState): SelectedHeading | undefined {
  const markdown = state.doc.toString()
  const tree = deriveHeadingTree(markdown)
  const heading = flattenHeadingTree(tree).findLast(
    ({ from }) => from <= state.selection.main.head,
  )
  return heading ? { state, markdown, tree, heading } : undefined
}

export function outlineHeadingActions({
  history,
  view,
}: {
  history: MoveHistory
  view: EditorView
}): OutlineHeadingActionsProps {
  const onUndo = () => {
    history.undo(view).match(ignore, ignore)
  }
  const rendered = selectedHeading(view.state)
  if (!rendered) return { onUndo }

  // A remote edit can land between rendering and the tap, so each action resolves its offsets when it runs.
  const moveAction = (
    resolve: (selected: SelectedHeading) => MoveBlockInput | undefined,
  ) =>
    resolve(rendered)
      ? () => {
          const selected = selectedHeading(view.state)
          const input = selected && resolve(selected)
          if (input) history.move(input, view).match(ignore, ignore)
        }
      : undefined

  return {
    onDelete: () => {
      const selected = selectedHeading(view.state)
      if (selected)
        applyHeadingChange(
          view,
          deleteHeadingChange(selected.markdown, selected.heading),
        )
    },
    onIndent: moveAction(({ state, heading }) =>
      headingChildMove(state, heading.from),
    ),
    onMoveDown: moveAction(({ state, heading }) =>
      adjacentMove(state, heading.from, 'down'),
    ),
    onMoveUp: moveAction(({ state, heading }) =>
      adjacentMove(state, heading.from, 'up'),
    ),
    onOutdent: moveAction(({ markdown, tree, heading }) =>
      outdentHeadingMove(markdown, tree, heading),
    ),
    onUndo,
  }
}
