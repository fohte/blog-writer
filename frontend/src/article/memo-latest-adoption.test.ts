import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  addMemo,
  dismissMemo,
  findLatestAdoptedMemoId,
  listMemos,
  setBody,
  setMemoAdoptedTo,
} from '#article/index'

const march1 = '2026-03-01T00:00:00.000Z'
const march2 = '2026-03-02T00:00:00.000Z'

describe('findLatestAdoptedMemoId', () => {
  it.each<{
    name: string
    arrange: (doc: Y.Doc) => void
    expected: string | undefined
  }>([
    {
      name: 'the newest of several adoptions',
      arrange: (doc) => {
        setMemoAdoptedTo(doc, 'memo-a', 0, march2)
        setMemoAdoptedTo(doc, 'memo-b', 0, march1)
      },
      expected: 'memo-a',
    },
    {
      name: 'an adoption that records the current time',
      arrange: (doc) => {
        setMemoAdoptedTo(doc, 'memo-a', 0, '2000-01-01T00:00:00.000Z')
        setMemoAdoptedTo(doc, 'memo-b', 0)
      },
      expected: 'memo-b',
    },
    {
      name: 'the next adoption once the newest is dismissed',
      arrange: (doc) => {
        setMemoAdoptedTo(doc, 'memo-a', 0, march1)
        setMemoAdoptedTo(doc, 'memo-b', 0, march2)
        dismissMemo(doc, 'memo-b')
      },
      expected: 'memo-a',
    },
    {
      name: 'no memo when none is adopted',
      arrange: () => {},
      expected: undefined,
    },
    {
      name: 'no memo when an adoption has no recorded time',
      arrange: (doc) => {
        setMemoAdoptedTo(doc, 'memo-a', 0, march1)
        doc.getMap<Y.Map<unknown>>('memos').get('memo-a')?.delete('adoptedAt')
      },
      expected: undefined,
    },
  ])('finds $name', ({ arrange, expected }) => {
    const doc = new Y.Doc()
    setBody(doc, '# Heading\n')
    addMemo(doc, { id: 'memo-a', text: 'First note', order: 0 })
    addMemo(doc, { id: 'memo-b', text: 'Second note', order: 1 })
    arrange(doc)

    expect(findLatestAdoptedMemoId(doc, listMemos(doc))).toBe(expected)
    doc.destroy()
  })
})
