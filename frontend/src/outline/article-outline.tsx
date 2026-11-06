import { Compartment, EditorSelection, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'

import type { MoveBlockInput } from '#article/index'
import { flattenHeadingTree } from '#article/index'
import type { Heading } from '#article/types'
import { OutlineView } from '#components/outline-view'
import { useArticleHeadings } from '#hooks/use-article-headings'
import {
  adoptMemoToHeading,
  insertMemoAsHeading,
  memoAdoptionErrorMessage,
} from '#memos/adoption'
import type { MoveHistory } from '#outline/move-history'

export interface ArticleOutlineProps {
  doc: Y.Doc
  history: MoveHistory
  view: EditorView
  activeFrom?: number
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
}: ArticleOutlineProps) {
  const { headings, markdown } = useArticleHeadings(doc)
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
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        activeHeadingCompartment.of(listener),
      ),
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
      history.onError((moveError) => {
        setError(moveError?.message)
      }),
    [history],
  )

  const handleMove = useCallback(
    (input: MoveBlockInput) => {
      return history.move(input, view).match(
        () => true,
        () => false,
      )
    },
    [history, view],
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

  return (
    <OutlineView
      bodyLength={markdown.length}
      headings={headings}
      {...(selectedHeadingFrom === undefined
        ? {}
        : { activeFrom: selectedHeadingFrom })}
      {...(error === undefined ? {} : { error })}
      onMove={handleMove}
      onAdoptMemo={handleAdoptMemo}
      onInsertMemo={handleInsertMemo}
      onSelect={(from) => {
        setError(undefined)
        view.focus()
        view.dispatch({
          selection: EditorSelection.cursor(from),
          effects: EditorView.scrollIntoView(from, { y: 'start' }),
        })
      }}
    />
  )
}
