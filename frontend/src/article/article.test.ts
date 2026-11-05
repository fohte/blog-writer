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
  it('reads and writes body and premise fields', () => {
    const doc = new Y.Doc()
    doc.getMap('references').set('source', 'external root')

    setBody(doc, '# Draft')
    setPremise(doc, 'audience', 'new readers')
    setPremise(doc, 'purpose', 'explain a topic')
    setPremise(doc, 'claim', 'a clear claim')
    setPremise(doc, 'purpose', null)

    const actual = Object.fromEntries([
      ['body', readBody(doc)],
      ['premise', getPremise(doc)],
      ['otherRoot', doc.getMap('references').get('source')],
    ])

    expect(actual).toEqual({
      body: '# Draft',
      premise: {
        audience: 'new readers',
        purpose: null,
        claim: 'a clear claim',
      },
      otherRoot: 'external root',
    })
  })

  it('adds, orders, dismisses, and restores memos', () => {
    const doc = new Y.Doc()
    addMemo(doc, { id: 'memo-a', text: 'first memo', order: 2 })
    addMemo(doc, { id: 'memo-b', text: 'second memo', order: 1 })
    updateMemoOrder(doc, 'memo-a', 0)
    dismissMemo(doc, 'memo-a')

    const dismissed = listMemos(doc)
    restoreMemo(doc, 'memo-a')

    const actual = Object.fromEntries([
      [
        'dismissed',
        dismissed.map(({ id, order, state }) => ({
          id,
          order,
          state: state.kind,
        })),
      ],
      [
        'restored',
        listMemos(doc).map(({ id, state }) => ({ id, state: state.kind })),
      ],
    ])

    expect(actual).toEqual({
      dismissed: [
        { id: 'memo-a', order: 0, state: 'dismissed' },
        { id: 'memo-b', order: 1, state: 'unorganized' },
      ],
      restored: [
        { id: 'memo-a', state: 'unorganized' },
        { id: 'memo-b', state: 'unorganized' },
      ],
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

  it('returns memos to unorganized when the adopted marker is deleted and replaced', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: 'section memo', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)

    setBody(doc, '# Replacement')

    expect(
      getMemoState(doc, 'memo-a').match(
        (state) => state.kind,
        (error) => error.name,
      ),
    ).toEqual('unorganized')
  })

  it('keeps adopted state after the Y.Doc update is applied to another document', () => {
    const doc = new Y.Doc()
    setBody(doc, '# Section')
    addMemo(doc, { id: 'memo-a', text: 'section memo', order: 0 })
    setMemoAdoptedTo(doc, 'memo-a', 0)

    const replica = new Y.Doc()
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))

    expect(
      getMemoState(replica, 'memo-a').match(
        (state) => state.kind,
        (error) => error.name,
      ),
    ).toEqual('adopted')
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
