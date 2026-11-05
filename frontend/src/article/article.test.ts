import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  addMemo,
  deriveHeadingTree,
  dismissMemo,
  getMemoState,
  getPremise,
  listMemos,
  readBody,
  restoreMemo,
  setBody,
  setMemoAdoptedTo,
  setPremise,
  updateMemoOrder,
} from '#article/index'

describe('article model', () => {
  it('reads and writes body text', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Draft')

    expect(readBody(doc)).toEqual('# Draft')
  })

  it('reads and writes premise fields', () => {
    const doc = new Y.Doc()
    doc.getMap('references').set('source', 'external root')
    setPremise(doc, 'audience', 'new readers')
    setPremise(doc, 'purpose', 'explain a topic')
    setPremise(doc, 'claim', 'a clear claim')
    setPremise(doc, 'purpose', null)

    expect(
      Object.fromEntries([
        ['premise', getPremise(doc)],
        ['otherRoot', doc.getMap('references').get('source')],
      ]),
    ).toEqual({
      premise: {
        audience: 'new readers',
        purpose: null,
        claim: 'a clear claim',
      },
      otherRoot: 'external root',
    })
  })

  it('adds a memo', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: 'first memo', order: 2 })

    expect(listMemos(doc)).toEqual([
      {
        id: 'memo-a',
        text: 'first memo',
        order: 2,
        state: { kind: 'unorganized' },
      },
    ])
  })

  it('updates a memo order', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: 'first memo', order: 2 })
    addMemo(doc, { id: 'memo-b', text: 'second memo', order: 1 })
    updateMemoOrder(doc, 'memo-a', 0)

    expect(listMemos(doc)).toEqual([
      {
        id: 'memo-a',
        text: 'first memo',
        order: 0,
        state: { kind: 'unorganized' },
      },
      {
        id: 'memo-b',
        text: 'second memo',
        order: 1,
        state: { kind: 'unorganized' },
      },
    ])
  })

  it.each([
    {
      name: 'empty ID',
      input: { id: '', text: 'new memo', order: 0 },
      duplicate: false,
      error: 'InvalidMemoError',
      memos: [],
    },
    {
      name: 'non-finite order',
      input: {
        id: 'memo-a',
        text: 'new memo',
        order: Number.POSITIVE_INFINITY,
      },
      duplicate: false,
      error: 'InvalidMemoError',
      memos: [],
    },
    {
      name: 'duplicate ID',
      input: { id: 'memo-a', text: 'duplicate memo', order: 1 },
      duplicate: true,
      error: 'MemoAlreadyExistsError',
      memos: [
        {
          id: 'memo-a',
          text: 'existing memo',
          order: 0,
          state: { kind: 'unorganized' },
        },
      ],
    },
  ])('rejects an add with $name', ({ input, duplicate, error, memos }) => {
    const doc = new Y.Doc()
    if (duplicate)
      addMemo(doc, { id: 'memo-a', text: 'existing memo', order: 0 })
    const result = addMemo(doc, input)

    expect(
      Object.fromEntries([
        [
          'result',
          result.match(
            () => 'ok',
            (error) => error.name,
          ),
        ],
        ['memos', listMemos(doc)],
      ]),
    ).toEqual({ result: error, memos })
  })

  it.each([
    {
      name: 'non-finite order',
      id: 'memo-a',
      order: Number.NaN,
      error: 'InvalidMemoError',
    },
    {
      name: 'unknown memo ID',
      id: 'missing',
      order: 1,
      error: 'MemoNotFoundError',
    },
  ])('rejects an order update with $name', ({ id, order, error }) => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: 'first memo', order: 0 })
    const result = updateMemoOrder(doc, id, order)

    expect(
      Object.fromEntries([
        [
          'result',
          result.match(
            () => 'ok',
            (updateError) => updateError.name,
          ),
        ],
        ['memos', listMemos(doc)],
      ]),
    ).toEqual({
      result: error,
      memos: [
        {
          id: 'memo-a',
          text: 'first memo',
          order: 0,
          state: { kind: 'unorganized' },
        },
      ],
    })
  })

  it('dismisses a memo', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: 'first memo', order: 0 })
    dismissMemo(doc, 'memo-a')

    expect(
      getMemoState(doc, 'memo-a').match(
        (state) => state,
        (error) => error.name,
      ),
    ).toEqual({
      kind: 'dismissed',
    })
  })

  it('restores a dismissed memo to unorganized', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: 'first memo', order: 0 })
    dismissMemo(doc, 'memo-a')
    restoreMemo(doc, 'memo-a')

    expect(
      getMemoState(doc, 'memo-a').match(
        (state) => state,
        (error) => error.name,
      ),
    ).toEqual({
      kind: 'unorganized',
    })
  })

  it('restores an adopted memo to unorganized', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: 'section memo', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)
    restoreMemo(doc, 'memo-a')

    expect(
      getMemoState(doc, 'memo-a').match(
        (state) => state,
        (error) => error.name,
      ),
    ).toEqual({
      kind: 'unorganized',
    })
  })

  it('rejects a non-heading marker without changing memo state', () => {
    const doc = new Y.Doc()
    setBody(doc, 'Intro')
    addMemo(doc, { id: 'memo-a', text: 'first memo', order: 0 })
    const result = setMemoAdoptedTo(doc, 'memo-a', 0)

    expect(
      Object.fromEntries([
        [
          'result',
          result.match(
            () => 'ok',
            (error) => error.name,
          ),
        ],
        [
          'state',
          getMemoState(doc, 'memo-a').match(
            (state) => state,
            (error) => error.name,
          ),
        ],
      ]),
    ).toEqual({
      result: 'InvalidHeadingError',
      state: { kind: 'unorganized' },
    })
  })

  it('keeps adoption attached to the heading marker through edits and depth changes', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: 'section memo', order: 0 })
    const markerIndex = readBody(doc).indexOf('#')
    setMemoAdoptedTo(doc, 'memo-a', markerIndex)

    const body = doc.getText('body')
    body.insert(markerIndex + 1, '#')
    body.delete(markerIndex + 3, 'Section'.length)
    body.insert(markerIndex + 3, 'Updated')
    body.insert(0, '\n')

    expect(
      getMemoState(doc, 'memo-a').match(
        (state) =>
          state.kind === 'adopted'
            ? { kind: state.kind, heading: state.heading }
            : state,
        (error) => error.name,
      ),
    ).toEqual({
      kind: 'adopted',
      heading: { level: 2, text: 'Updated', from: 1, to: 11, children: [] },
    })
  })

  it('returns a memo to unorganized when its adopted marker is deleted and replaced', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: 'section memo', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)
    setBody(doc, '# Replacement')

    expect(
      getMemoState(doc, 'memo-a').match(
        (state) => state,
        (error) => error.name,
      ),
    ).toEqual({
      kind: 'unorganized',
    })
  })

  it('keeps adopted state after a Y.Doc update is applied to another document', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: 'section memo', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)

    const replica = new Y.Doc()
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))

    expect(
      getMemoState(replica, 'memo-a').match(
        (state) => state,
        (error) => error.name,
      ),
    ).toEqual({
      kind: 'adopted',
      heading: { level: 1, text: 'Section', from: 0, to: 9, children: [] },
    })
  })

  it('derives a hierarchy from ATX headings and ignores non-heading syntax', () => {
    const markdown =
      '# Root\n## Child\n#### Deep\n## Next\n\nTitle\n=====\n\n```md\n# Code\n```'

    expect(deriveHeadingTree(markdown)).toEqual([
      {
        level: 1,
        text: 'Root',
        from: 0,
        to: 6,
        children: [
          {
            level: 2,
            text: 'Child',
            from: 7,
            to: 15,
            children: [
              { level: 4, text: 'Deep', from: 16, to: 25, children: [] },
            ],
          },
          { level: 2, text: 'Next', from: 26, to: 33, children: [] },
        ],
      },
    ])
  })

  it('preserves indentation offsets and trailing hash characters in heading text', () => {
    expect(deriveHeadingTree('  ### C#')).toEqual([
      { level: 3, text: 'C#', from: 2, to: 8, children: [] },
    ])
  })
})
