import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { act } from 'react'
import { userEvent } from 'vitest/browser'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import { getBody, listMemos, setBody } from '#article/index'
import { createMoveHistory } from '#outline/index'

export type HistoryEditor = {
  body: Y.Text
  doc: Y.Doc
  history: ReturnType<typeof createMoveHistory>
  view: EditorView
  host: HTMLDivElement
}

const cleanups: (() => void)[] = []

export function cleanupHistoryEditors(): void {
  for (const cleanup of cleanups.splice(0)) cleanup()
}

export function createHistoryEditor(
  markdown: string,
  onUpdate?: (update: ViewUpdate) => void,
): HistoryEditor {
  const doc = new Y.Doc()
  setBody(doc, markdown)
  const body = getBody(doc)
  const history = createMoveHistory(doc)
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: markdown,
      extensions: [
        history.extension,
        yCollab(body, null, { undoManager: false }),
        ...(onUpdate ? [EditorView.updateListener.of(onUpdate)] : []),
      ],
    }),
  })

  cleanups.push(() => {
    view.destroy()
    history.destroy()
    doc.destroy()
    host.remove()
  })

  return { body, doc, history, view, host }
}

export function edit(
  editor: HistoryEditor,
  from: number,
  to: number,
  insert: string,
  userEvent: string,
  time?: number,
): void {
  editor.view.dispatch({
    changes: { from, to, insert },
    annotations: [
      Transaction.userEvent.of(userEvent),
      ...(time === undefined ? [] : [Transaction.time.of(time)]),
    ],
  })
}

export function step(
  editor: HistoryEditor,
  direction: 'undo' | 'redo',
): boolean {
  return editor.history[direction](editor.view).match(
    (changed) => changed,
    (error) => {
      throw error
    },
  )
}

function modifierKey() {
  return navigator.platform.includes('Mac') ? 'Meta' : 'Control'
}

export async function pressUndo(view: EditorView) {
  view.focus()
  const modifier = modifierKey()
  await act(async () => {
    await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
  })
}

export async function pressRedo(view: EditorView) {
  view.focus()
  const modifier = modifierKey()
  await act(async () => {
    await userEvent.keyboard(`{${modifier}>}{Shift>}z{/Shift}{/${modifier}}`)
  })
}

export function readSelection(selection: EditorSelection) {
  return {
    ranges: selection.ranges.map(({ anchor, head }) => ({ anchor, head })),
  }
}

export function readMemoStates(doc: Y.Doc) {
  return listMemos(doc).map(({ id, state }) => ({
    id,
    state:
      state.kind === 'adopted'
        ? {
            kind: state.kind,
            heading: {
              from: state.heading.from,
              level: state.heading.level,
              text: state.heading.text,
            },
          }
        : { kind: state.kind },
  }))
}

export function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state
  }
}

export function seededRandomIndex(seed: number): (length: number) => number {
  const random = seededRandom(seed)
  return (length) => (random() >>> 8) % length
}

export function isSafeUtf16Boundary(value: string, offset: number): boolean {
  const previous = value.charCodeAt(offset - 1)
  const current = value.charCodeAt(offset)
  return !(
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    current >= 0xdc00 &&
    current <= 0xdfff
  )
}

export function syncDocs(left: Y.Doc, right: Y.Doc): void {
  const leftUpdate = Y.encodeStateAsUpdate(left, Y.encodeStateVector(right))
  const rightUpdate = Y.encodeStateAsUpdate(right, Y.encodeStateVector(left))
  Y.applyUpdate(right, leftUpdate, 'remote')
  Y.applyUpdate(left, rightUpdate, 'remote')
}
