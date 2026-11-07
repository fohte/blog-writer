import type { EditorView } from '@codemirror/view'

import type { MoveBlockInput } from '#article/index'
import type { BlockMoveMenuAction } from '#components/block-move-menu'
import {
  adjacentMove,
  headingChildMove,
  isHeadingBlockAt,
} from '#outline/block-ranges'

/**
 * `resolvePosition` re-reads the block position when an action runs, because the document can change while the menu is open.
 */
export function blockMoveActions(
  view: EditorView,
  position: number,
  resolvePosition: () => number | undefined,
): BlockMoveMenuAction[] {
  const action = (
    label: string,
    getInput: (position: number) => MoveBlockInput | undefined,
  ): BlockMoveMenuAction => ({
    label,
    input: getInput(position),
    resolveInput: () => {
      const currentPosition = resolvePosition()
      return currentPosition === undefined
        ? undefined
        : getInput(currentPosition)
    },
  })

  return [
    action('Move up', (from) => adjacentMove(view.state, from, 'up')),
    action('Move down', (from) => adjacentMove(view.state, from, 'down')),
    ...(isHeadingBlockAt(view.state, position)
      ? [action('Make child', (from) => headingChildMove(view.state, from))]
      : []),
  ]
}
