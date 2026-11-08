import type { EditorView } from '@codemirror/view'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { deriveHeadingTree, flattenHeadingTree } from '#article/index'
import type { Heading } from '#article/types'
import type {
  OutlineHeadingEditing,
  OutlineKeyAction,
} from '#components/outline-heading-input'
import { adjacentMove, headingChildMove } from '#outline/block-ranges'
import {
  addHeadingBelowChange,
  applyHeadingChange as applyChange,
  deleteHeadingChange,
  outdentHeadingMove,
  renameHeadingChange,
} from '#outline/heading-edits'
import type { MoveHistory } from '#outline/move-history'

// The outline shows history failures through `history.onError`.
const ignore = () => undefined

function readHeadings(view: EditorView) {
  const markdown = view.state.doc.toString()
  const tree = deriveHeadingTree(markdown)
  return { markdown, tree, flat: flattenHeadingTree(tree) }
}

export function useOutlineKeyboard({
  headings,
  history,
  selectedFrom,
  view,
}: {
  headings: readonly Heading[]
  history: MoveHistory
  selectedFrom: number | undefined
  view: EditorView
}): (OutlineHeadingEditing & { from: number }) | undefined {
  // shortcut: an ordinal does not follow a concurrent edit above the row, which moves the selection and drops the draft; map a document position if editing the outline from several devices at once becomes common.
  const [index, setIndex] = useState<number>()
  const [focusKey, setFocusKey] = useState(0)
  // Moving through the history focuses the editor, and a row can unmount while focused; neither is the user leaving.
  const transitioning = useRef(false)
  const flat = useMemo(() => flattenHeadingTree(headings), [headings])
  const selectedFromRef = useRef(selectedFrom)
  selectedFromRef.current = selectedFrom
  const flatRef = useRef(flat)
  flatRef.current = flat

  useLayoutEffect(() => {
    transitioning.current = false
  }, [focusKey, index])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key !== '1'
      )
        return
      event.preventDefault()
      if (flatRef.current.length === 0) return
      const selected = flatRef.current.findIndex(
        ({ from }) => from === selectedFromRef.current,
      )
      setIndex(Math.max(selected, 0))
      setFocusKey((key) => key + 1)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  if (index === undefined) return undefined
  const clampedIndex = Math.min(index, flat.length - 1)
  const current = flat[clampedIndex]
  if (!current) return undefined

  const rename = (draft: string) => {
    const { markdown, flat: latest } = readHeadings(view)
    const heading = latest[clampedIndex]
    if (heading)
      applyChange(view, renameHeadingChange(markdown, heading, draft))
  }

  const followMove = (from: number) => {
    const moved = readHeadings(view).flat.findIndex(
      (heading) => heading.from === from,
    )
    return moved === -1 ? clampedIndex : moved
  }

  // History does not report where a heading went, and the nearest match resolves duplicate texts.
  const followText = (text: string) =>
    readHeadings(view).flat.reduce<number | undefined>(
      (nearest, heading, position) =>
        heading.text === text &&
        (nearest === undefined ||
          Math.abs(position - clampedIndex) < Math.abs(nearest - clampedIndex))
          ? position
          : nearest,
      undefined,
    ) ?? clampedIndex

  const moveAndFollow = (
    input: Parameters<MoveHistory['move']>[0] | undefined,
  ) =>
    input
      ? history.move(input, view).match(
          ({ from }) => followMove(from),
          () => clampedIndex,
        )
      : clampedIndex

  const nextIndex = (action: OutlineKeyAction): number | undefined => {
    const { markdown, tree, flat: latest } = readHeadings(view)
    const heading = latest[clampedIndex]
    if (!heading) return undefined
    switch (action) {
      case 'previous':
        return Math.max(clampedIndex - 1, 0)
      case 'next':
        return Math.min(clampedIndex + 1, latest.length - 1)
      case 'add':
        applyChange(view, addHeadingBelowChange(markdown, heading))
        return clampedIndex + 1
      case 'indent':
        return moveAndFollow(headingChildMove(view.state, heading.from))
      case 'outdent':
        return moveAndFollow(outdentHeadingMove(markdown, tree, heading))
      case 'move-up':
        return moveAndFollow(adjacentMove(view.state, heading.from, 'up'))
      case 'move-down':
        return moveAndFollow(adjacentMove(view.state, heading.from, 'down'))
      case 'delete':
        applyChange(view, deleteHeadingChange(markdown, heading))
        return Math.max(clampedIndex - 1, 0)
      case 'undo':
        history.undo(view).match(ignore, ignore)
        return followText(heading.text)
      case 'redo':
        history.redo(view).match(ignore, ignore)
        return followText(heading.text)
      case 'exit':
        view.focus()
        return undefined
    }
  }

  return {
    from: current.from,
    focusKey,
    onAction: (action, draft) => {
      transitioning.current = true
      if (action !== 'delete') rename(draft)
      setIndex(nextIndex(action))
      setFocusKey((key) => key + 1)
    },
    onBlur: (draft) => {
      if (transitioning.current) return
      transitioning.current = true
      rename(draft)
      setIndex(undefined)
      setFocusKey((key) => key + 1)
    },
  }
}
