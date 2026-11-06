import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { err, type Result } from 'neverthrow'
import * as Y from 'yjs'

import {
  deriveHeadingTree,
  InvalidHeadingError,
  InvalidMemoError,
  listMemos,
  MemoNotFoundError,
  setMemoAdoptedTo,
} from '#article/index'
import type { Heading } from '#article/types'

function flattenHeadings(headings: Heading[]): Heading[] {
  return headings.flatMap((heading) => [
    heading,
    ...flattenHeadings(heading.children),
  ])
}

export function insertMemoAsHeading(
  doc: Y.Doc,
  view: EditorView,
  memoId: string,
  beforeFrom?: number,
): Result<void, MemoNotFoundError | InvalidHeadingError | InvalidMemoError> {
  const memo = listMemos(doc).find(({ id }) => id === memoId)
  if (!memo) return err(new MemoNotFoundError(memoId))
  if (memo.state.kind === 'dismissed')
    return err(new InvalidMemoError('Dismissed memos cannot be adopted'))

  const markdown = view.state.doc.toString()
  const headings = flattenHeadings(deriveHeadingTree(markdown))
  const target =
    beforeFrom === undefined
      ? undefined
      : headings.find(({ from }) => from === beforeFrom)
  if (beforeFrom !== undefined && !target)
    return err(new InvalidHeadingError(beforeFrom))

  const headingText = memo.text.replace(/\r?\n/gu, ' ').trim()
  if (headingText.length === 0)
    return err(new InvalidMemoError('Memo text must not be empty'))

  const position = target?.from ?? markdown.length
  const previousText = markdown.slice(0, position)
  const separator =
    previousText.length === 0
      ? ''
      : previousText.endsWith('\n\n')
        ? ''
        : previousText.endsWith('\n')
          ? '\n'
          : '\n\n'
  const level = target?.level ?? headings.at(-1)?.level ?? 2
  const markerIndex = position + separator.length
  const cursor = markerIndex + level + 1 + headingText.length
  view.dispatch({
    changes: {
      from: position,
      insert: `${separator}${'#'.repeat(level)} ${headingText}\n\n`,
    },
    selection: EditorSelection.cursor(cursor),
  })
  view.focus()

  return setMemoAdoptedTo(doc, memoId, markerIndex)
}

export function adoptMemoToHeading(
  doc: Y.Doc,
  memoId: string,
  markerIndex: number,
) {
  return setMemoAdoptedTo(doc, memoId, markerIndex).map(() => undefined)
}
