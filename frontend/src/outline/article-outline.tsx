import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useState } from 'react'
import type * as Y from 'yjs'

import type { MoveBlockInput } from '#article/index'
import { deriveHeadingTree, getBody, readBody } from '#article/index'
import { OutlineView } from '#components/outline-view'
import type { MoveHistory } from '#outline/move-history'

export interface ArticleOutlineProps {
  doc: Y.Doc
  history: MoveHistory
  view: EditorView
  activeFrom?: number
}

export function ArticleOutline({
  doc,
  history,
  view,
  activeFrom,
}: ArticleOutlineProps) {
  const body = getBody(doc)
  const [markdown, setMarkdown] = useState(() => readBody(doc))
  const [error, setError] = useState<string>()

  useEffect(() => {
    const update = () => {
      setMarkdown(body.toJSON())
    }
    body.observe(update)
    return () => {
      body.unobserve(update)
    }
  }, [body])

  const handleMove = useCallback(
    (input: MoveBlockInput) => {
      history.move(input, view).match(
        () => {
          setError(undefined)
        },
        (moveError) => {
          setError(moveError.message)
        },
      )
    },
    [history, view],
  )

  return (
    <OutlineView
      bodyLength={markdown.length}
      headings={deriveHeadingTree(markdown)}
      {...(activeFrom === undefined ? {} : { activeFrom })}
      {...(error === undefined ? {} : { error })}
      onMove={handleMove}
      onSelect={(from) => {
        view.focus()
        view.dispatch({
          selection: EditorSelection.cursor(from),
          effects: EditorView.scrollIntoView(from, { y: 'start' }),
        })
      }}
    />
  )
}
