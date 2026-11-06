import { Compartment, EditorSelection, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'

import type { MoveBlockInput } from '#article/index'
import { deriveHeadingTree, getBody, readBody } from '#article/index'
import type { Heading } from '#article/types'
import { OutlineView } from '#components/outline-view'
import type { MoveHistory } from '#outline/move-history'

export interface ArticleOutlineProps {
  doc: Y.Doc
  history: MoveHistory
  view: EditorView
  activeFrom?: number
  onHeadingSelected?: () => void
}

function activeHeadingFrom(
  headings: Heading[],
  position: number,
): number | undefined {
  return flattenHeadings(headings).findLast(
    (heading) => heading.from <= position,
  )?.from
}

function flattenHeadings(headings: Heading[]): Heading[] {
  return headings.flatMap((heading) => [
    heading,
    ...flattenHeadings(heading.children),
  ])
}

export function ArticleOutline({
  doc,
  history,
  view,
  activeFrom,
  onHeadingSelected,
}: ArticleOutlineProps) {
  const body = getBody(doc)
  const [markdown, setMarkdown] = useState(() => readBody(doc))
  const [error, setError] = useState<string>()
  const headings = useMemo(() => deriveHeadingTree(markdown), [markdown])
  const activeHeadingCompartment = useMemo(() => new Compartment(), [])
  const headingsRef = useRef(headings)
  headingsRef.current = headings
  const [selectedFrom, setSelectedFrom] = useState(
    () =>
      activeFrom ?? activeHeadingFrom(headings, view.state.selection.main.head),
  )

  useEffect(() => {
    const update = () => {
      setMarkdown(body.toJSON())
      setError(undefined)
    }
    body.observe(update)
    return () => {
      body.unobserve(update)
    }
  }, [body])

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
