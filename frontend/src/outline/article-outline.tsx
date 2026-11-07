import { Compartment, EditorSelection, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'

import type { MoveBlockInput } from '#article/index'
import { findMoveBlockRange, flattenHeadingTree } from '#article/index'
import type { Heading } from '#article/types'
import { OutlineView } from '#components/outline-view'
import { useArticleHeadings } from '#hooks/use-article-headings'
import {
  adoptMemoToHeading,
  insertMemoAsHeading,
  memoAdoptionErrorMessage,
} from '#memos/adoption'
import { useMemos } from '#memos/use-memos'
import type { MoveHistory } from '#outline/move-history'
import type { OutlineProposalState } from '#proposals/outline'

export interface ArticleOutlineProps {
  doc: Y.Doc
  history: MoveHistory
  view: EditorView
  activeFrom?: number
  onHeadingSelected?: () => void
  onActiveHeadingChange?: ((heading: Heading | undefined) => void) | undefined
  proposalState?: OutlineProposalState
  onProposalAccept?: (id: string) => void
  onProposalReject?: (id: string) => void
}

const HISTORY_FAILURE_PRESENTATION = {
  move: {
    label: 'Block move failed',
    message: 'この位置には移動できません。',
  },
  undo: { label: 'History undo failed', message: '元に戻せませんでした。' },
  redo: { label: 'History redo failed', message: 'やり直せませんでした。' },
}

function activeHeadingFrom(
  headings: Heading[],
  position: number,
): number | undefined {
  return flattenHeadingTree(headings).findLast(
    (heading) => heading.from <= position,
  )?.from
}

export function ArticleOutline({
  doc,
  history,
  view,
  activeFrom,
  onHeadingSelected,
  onActiveHeadingChange,
  proposalState,
  onProposalAccept,
  onProposalReject,
}: ArticleOutlineProps) {
  const { headings, markdown } = useArticleHeadings(doc)
  const { memos } = useMemos(doc)
  const memoCounts = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const { state } of memos) {
      if (state.kind !== 'adopted') continue
      counts[state.heading.from] = (counts[state.heading.from] ?? 0) + 1
    }
    return counts
  }, [memos])
  const [error, setError] = useState<string>()
  const activeHeadingCompartment = useMemo(() => new Compartment(), [])
  const headingsRef = useRef(headings)
  headingsRef.current = headings
  const [selectedFrom, setSelectedFrom] = useState(
    () =>
      activeFrom ?? activeHeadingFrom(headings, view.state.selection.main.head),
  )

  useEffect(() => {
    setError(undefined)
  }, [markdown])

  useEffect(() => {
    const listener = EditorView.updateListener.of((update) => {
      if (!update.docChanged && !update.selectionSet) return
      setSelectedFrom(
        activeHeadingFrom(
          headingsRef.current,
          update.state.selection.main.head,
        ),
      )
    })
    const configured = activeHeadingCompartment.get(view.state)
    view.dispatch({
      effects:
        configured === undefined
          ? StateEffect.appendConfig.of(activeHeadingCompartment.of(listener))
          : activeHeadingCompartment.reconfigure(listener),
    })
    setSelectedFrom(activeHeadingFrom(headings, view.state.selection.main.head))
    return () => {
      view.dispatch({
        effects: activeHeadingCompartment.reconfigure([]),
      })
    }
  }, [activeHeadingCompartment, view])

  useEffect(() => {
    setSelectedFrom(
      activeFrom ?? activeHeadingFrom(headings, view.state.selection.main.head),
    )
  }, [activeFrom, headings, view])

  useEffect(
    () =>
      history.onError((failure) => {
        if (failure === undefined) {
          setError(undefined)
          return
        }

        const presentation = HISTORY_FAILURE_PRESENTATION[failure.operation]
        console.warn(presentation.label, failure.error)
        setError(presentation.message)
      }),
    [history],
  )

  const handleMove = useCallback(
    (input: MoveBlockInput) => {
      if (input.childOf === undefined) {
        const sourceRange = findMoveBlockRange(markdown, input.from)
        if (
          sourceRange !== undefined &&
          (input.destination === sourceRange.from ||
            input.destination === sourceRange.to)
        ) {
          return true
        }
      }

      return history.move(input, view).match(
        () => true,
        () => false,
      )
    },
    [history, markdown, view],
  )
  const handleAdoptMemo = useCallback(
    (memoId: string, markerIndex: number) => {
      setError(
        memoAdoptionErrorMessage(() =>
          adoptMemoToHeading(doc, memoId, markerIndex),
        ),
      )
    },
    [doc],
  )
  const handleInsertMemo = useCallback(
    (memoId: string, beforeFrom?: number) => {
      setError(
        memoAdoptionErrorMessage(() =>
          insertMemoAsHeading(doc, view, memoId, beforeFrom),
        ),
      )
    },
    [doc, view],
  )
  const selectedHeadingFrom = activeFrom ?? selectedFrom

  useEffect(() => {
    onActiveHeadingChange?.(
      flattenHeadingTree(headings).find(
        (heading) => heading.from === selectedHeadingFrom,
      ),
    )
  }, [headings, onActiveHeadingChange, selectedHeadingFrom])

  return (
    <OutlineView
      bodyLength={markdown.length}
      headings={headings}
      {...(selectedHeadingFrom === undefined
        ? {}
        : { activeFrom: selectedHeadingFrom })}
      {...(error === undefined ? {} : { error })}
      {...(proposalState === undefined ? {} : { proposalState })}
      memoCounts={memoCounts}
      onMove={handleMove}
      onAdoptMemo={handleAdoptMemo}
      onInsertMemo={handleInsertMemo}
      {...(onProposalAccept === undefined ? {} : { onProposalAccept })}
      {...(onProposalReject === undefined ? {} : { onProposalReject })}
      onSelect={(from) => {
        setError(undefined)
        view.focus()
        view.dispatch({
          selection: EditorSelection.cursor(from),
          effects: EditorView.scrollIntoView(from, { y: 'start' }),
        })
        onHeadingSelected?.()
      }}
    />
  )
}
