import { EditorState, Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  addMemo,
  blockMoved,
  deriveHeadingTree,
  dismissMemo,
  getBody,
  getMemoState,
  getPremise,
  listMemos,
  moveBlock,
  observeMemos,
  readBody,
  registerBlockMoveUpdater,
  restoreMemo,
  reverseBlockMove,
  setBody,
  setMemoAdoptedTo,
  setPremise,
  updateMemoOrder,
} from '#article/index'

describe('article model', () => {
  it('moves a heading section and reanchors memo and registered markers in one transaction', () => {
    const doc = new Y.Doc()
    const markdown = `# Alpha

Alpha text

## Nested

Nested text

# Beta

Beta text
`
    setBody(doc, markdown)
    addMemo(doc, { id: 'memo-a', text: 'nested note', order: 0 })
    const nestedFrom = markdown.indexOf('## Nested')
    setMemoAdoptedTo(doc, 'memo-a', nestedFrom)
    const body = doc.getText('body')
    const referenceData = doc.getMap('references')
    const oldMarker = markdown.indexOf('Nested text')
    const initialReference = Y.createRelativePositionFromTypeIndex(
      body,
      oldMarker + 1,
      -1,
    )
    referenceData.set('anchor', Y.relativePositionToJSON(initialReference))

    let transactionCount = 0
    let transactionOrigin: unknown
    doc.on('afterTransaction', (transaction) => {
      transactionCount += 1
      transactionOrigin = transaction.origin
    })
    const unregister = registerBlockMoveUpdater(doc, (mapping) => {
      const stored = referenceData.get('anchor')
      if (stored === undefined || typeof stored !== 'object') return
      const absolute = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(stored),
        doc,
      )
      if (!absolute) return
      const newMarker = mapping.mapPosition(absolute.index - 1)
      if (newMarker === undefined) return
      return () => {
        const moved = Y.createRelativePositionFromTypeIndex(
          body,
          newMarker + 1,
          -1,
        )
        referenceData.set('anchor', Y.relativePositionToJSON(moved))
      }
    })

    const result = moveBlock(doc, { from: 0, destination: markdown.length })
    unregister()
    const move = result.match(
      (value) => value,
      (error) => {
        throw new Error(error.message)
      },
    )
    const movedBody = readBody(doc)
    const movedMemos = listMemos(doc)
    const moveTransactionCount = transactionCount
    const moveTransactionOrigin = transactionOrigin
    const editorTransaction = EditorState.create({ doc: markdown }).update({
      changes: { from: 0, to: markdown.length, insert: movedBody },
      annotations: move.annotations,
    })
    const finalReference = referenceData.get('anchor')
    const finalAbsolute =
      finalReference !== undefined && typeof finalReference === 'object'
        ? Y.createAbsolutePositionFromRelativePosition(
            Y.createRelativePositionFromJSON(finalReference),
            doc,
          )
        : null
    const undo = reverseBlockMove(doc, move)._unsafeUnwrap()

    expect(
      Object.fromEntries([
        ['body', movedBody],
        ['restoredBody', readBody(doc)],
        ['undoEvent', undo.annotations[1].value],
        ['memo', movedMemos],
        ['referenceIndex', finalAbsolute?.index],
        ['transactionCount', moveTransactionCount],
        ['annotation', move.annotations[0].value],
        ['editorAnnotation', editorTransaction.annotation(blockMoved)],
        [
          'editorUserEvent',
          editorTransaction.annotation(Transaction.userEvent),
        ],
        [
          'originAnnotations',
          Array.isArray(moveTransactionOrigin)
            ? moveTransactionOrigin.map(
                (annotation: { value: unknown }) => annotation.value,
              )
            : null,
        ],
        ['oldMarker', oldMarker],
        ['newMarker', finalAbsolute ? finalAbsolute.index - 1 : null],
        ['annotationType', move.annotations[0].type === blockMoved],
      ]),
    ).toEqual({
      body: `# Beta

Beta text

# Alpha

Alpha text

## Nested

Nested text
`,
      restoredBody: markdown,
      undoEvent: 'undo',
      memo: [
        {
          id: 'memo-a',
          text: 'nested note',
          order: 0,
          state: {
            kind: 'adopted',
            heading: {
              level: 2,
              text: 'Nested',
              from: 40,
              to: 49,
              children: [],
            },
          },
        },
      ],
      referenceIndex: 52,
      transactionCount: 1,
      annotation: { from: 19, to: 63, seam: 0 },
      editorAnnotation: { from: 19, to: 63, seam: 0 },
      editorUserEvent: 'move',
      originAnnotations: [{ from: 19, to: 63, seam: 0 }, 'move'],
      oldMarker: 32,
      newMarker: 51,
      annotationType: true,
    })
  })

  it('moves a single Markdown block', () => {
    const doc = new Y.Doc()
    const markdown = `# Heading

First paragraph.

Second paragraph.

After.
`
    setBody(doc, markdown)
    const result = moveBlock(doc, {
      from: markdown.indexOf('Second paragraph.'),
      destination: markdown.length,
    })

    expect(
      Object.fromEntries([
        ['body', readBody(doc)],
        [
          'moved',
          result.match(
            (move) => move.annotations[0].value,
            (error) => error.name,
          ),
        ],
      ]),
    ).toEqual({
      body: `# Heading

First paragraph.

After.

Second paragraph.
`,
      moved: { from: 37, to: 55, seam: 29 },
    })
  })

  it('normalizes the source separator when moving the final block to the beginning', () => {
    const doc = new Y.Doc()
    const markdown = `X

A
`
    setBody(doc, markdown)
    const move = moveBlock(doc, {
      from: markdown.indexOf('A'),
      destination: 0,
    })._unsafeUnwrap()
    const afterMove = readBody(doc)
    const undo = reverseBlockMove(doc, move)._unsafeUnwrap()

    expect(
      Object.fromEntries([
        ['afterMove', afterMove],
        ['restored', readBody(doc)],
        ['undoEvent', undo.annotations[1].value],
      ]),
    ).toEqual({
      afterMove: `A

X
`,
      restored: markdown,
      undoEvent: 'undo',
    })
  })

  it('preserves block separators when reversing a reverse move', () => {
    const doc = new Y.Doc()
    const markdown = `A

B
`
    setBody(doc, markdown)
    const move = moveBlock(doc, {
      from: 0,
      destination: markdown.length,
    })._unsafeUnwrap()
    const afterMove = readBody(doc)
    const undo = reverseBlockMove(doc, move)._unsafeUnwrap()
    const afterUndo = readBody(doc)
    const redo = reverseBlockMove(doc, undo)._unsafeUnwrap()

    expect(
      Object.fromEntries([
        ['afterMove', afterMove],
        ['afterUndo', afterUndo],
        ['afterRedo', readBody(doc)],
        ['undoEvent', undo.annotations[1].value],
        ['redoEvent', redo.annotations[1].value],
      ]),
    ).toEqual({
      afterMove: `B

A
`,
      afterUndo: markdown,
      afterRedo: `B

A
`,
      undoEvent: 'undo',
      redoEvent: 'undo',
    })
  })

  it('keeps an unregistered marker at the source seam when its block moves', () => {
    const doc = new Y.Doc()
    const markdown = `# Heading

Stay.

Move me.

After.
`
    setBody(doc, markdown)
    const body = doc.getText('body')
    const marker = Y.createRelativePositionFromTypeIndex(
      body,
      markdown.indexOf('Move me.') + 1,
      -1,
    )

    moveBlock(doc, {
      from: markdown.indexOf('Move me.'),
      destination: markdown.length,
    })._unsafeUnwrap()

    const absolute = Y.createAbsolutePositionFromRelativePosition(marker, doc)
    expect(
      Object.fromEntries([
        ['body', readBody(doc)],
        ['markerIndex', absolute?.index],
      ]),
    ).toEqual({
      body: `# Heading

Stay.

After.

Move me.
`,
      markerIndex: 18,
    })
  })

  it('restores added separators when reversing a block without a trailing newline', () => {
    const doc = new Y.Doc()
    const markdown = `Alpha

Beta`
    setBody(doc, markdown)
    const move = moveBlock(doc, {
      from: 0,
      destination: markdown.length,
    })._unsafeUnwrap()
    const afterMove = readBody(doc)
    const undo = reverseBlockMove(doc, move)._unsafeUnwrap()

    expect(
      Object.fromEntries([
        ['afterMove', afterMove],
        ['restored', readBody(doc)],
        ['undoEvent', undo.annotations[1].value],
      ]),
    ).toEqual({
      afterMove: `Beta

Alpha
`,
      restored: markdown,
      undoEvent: 'undo',
    })
  })

  it('rejects a destination inside the selected section without changing the body', () => {
    const doc = new Y.Doc()
    const markdown = `# Parent

## Child

# Other
`
    setBody(doc, markdown)
    const result = moveBlock(doc, {
      from: markdown.indexOf('# Parent'),
      destination: markdown.indexOf('## Child'),
    })

    expect(
      Object.fromEntries([
        [
          'result',
          result.match(
            () => 'ok',
            (error) => error.name,
          ),
        ],
        ['body', readBody(doc)],
      ]),
    ).toEqual({
      result: 'InvalidBlockMoveError',
      body: markdown,
    })
  })

  it.each([
    {
      name: 'an equal-level heading',
      markdown: `# First

# Moved

# Target
`,
      movedHeading: '# Moved',
      destinationHeading: '# First',
      afterMove: `# Moved

# First

# Target
`,
    },
    {
      name: 'a shallower heading',
      markdown: `# First

## Moved

# Target
`,
      movedHeading: '## Moved',
      destinationHeading: '# First',
      afterMove: `## Moved

# First

# Target
`,
    },
  ])(
    'moves a section before $name and reverses it',
    ({ markdown, movedHeading, destinationHeading, afterMove }) => {
      const doc = new Y.Doc()
      setBody(doc, markdown)
      const move = moveBlock(doc, {
        from: markdown.indexOf(movedHeading),
        destination: markdown.indexOf(destinationHeading),
      })._unsafeUnwrap()
      const movedBody = readBody(doc)
      const undo = reverseBlockMove(doc, move)._unsafeUnwrap()

      expect(
        Object.fromEntries([
          ['movedBody', movedBody],
          ['restoredBody', readBody(doc)],
          ['undoEvent', undo.annotations[1].value],
        ]),
      ).toEqual({
        movedBody: afterMove,
        restoredBody: markdown,
        undoEvent: 'undo',
      })
    },
  )

  it.each([
    {
      name: 'a body block',
      markdown: `# H0

# H1

# H2

# H3

- l4
`,
      from: (markdown: string) => markdown.indexOf('# H2'),
      destination: (markdown: string) => markdown.indexOf('- l4'),
    },
    {
      name: 'a deeper heading',
      markdown: `## H0

# H1

## H2

### H3`,
      from: (markdown: string) => markdown.indexOf('## H0'),
      destination: (markdown: string) => markdown.indexOf('### H3'),
    },
  ])(
    'rejects a section destination before $name',
    ({ name, markdown, from, destination }) => {
      const doc = new Y.Doc()
      setBody(doc, markdown)
      const result = moveBlock(doc, {
        from: from(markdown),
        destination: destination(markdown),
      })

      expect(
        Object.fromEntries([
          ['case', name],
          [
            'result',
            result.match(
              () => 'ok',
              (error) => error.message,
            ),
          ],
          ['body', readBody(doc)],
        ]),
      ).toEqual({
        case: name,
        result:
          'The section destination must be before a heading at the same or a shallower level, or at the end of the document',
        body: markdown,
      })
    },
  )

  it.each([
    {
      name: 'outside the parent section',
      destination: (markdown: string) => markdown.length,
      childOf: true,
      error: 'The child destination is outside the parent section',
    },
    {
      name: 'inside a block while becoming a child',
      destination: (markdown: string) => markdown.indexOf('Parent text.') + 3,
      childOf: true,
      error: 'The destination is inside a Markdown block',
    },
    {
      name: 'inside a block during a plain move',
      destination: (markdown: string) => markdown.indexOf('Parent text.') + 3,
      childOf: false,
      error: 'The destination is inside a Markdown block',
    },
  ])('rejects a destination $name', ({ name, destination, childOf, error }) => {
    const markdown = `# Parent

Parent text.

# Other

# Moved
`
    const doc = new Y.Doc()
    setBody(doc, markdown)
    const result = moveBlock(doc, {
      from: markdown.indexOf('# Moved'),
      destination: destination(markdown),
      ...(childOf ? { childOf: markdown.indexOf('# Parent') } : {}),
    })

    expect(
      Object.fromEntries([
        ['case', name],
        [
          'result',
          result.match(
            () => 'ok',
            (moveError) => moveError.message,
          ),
        ],
        ['body', readBody(doc)],
      ]),
    ).toEqual({
      case: name,
      result: error,
      body: markdown,
    })
  })

  it('rejects a destination inside a blank-line separator', () => {
    const doc = new Y.Doc()
    const markdown = `A

B


C
`
    setBody(doc, markdown)
    const result = moveBlock(doc, {
      from: 0,
      destination: markdown.indexOf('C') - 1,
    })

    expect(
      Object.fromEntries([
        [
          'result',
          result.match(
            () => 'ok',
            (error) => error.message,
          ),
        ],
        ['body', readBody(doc)],
      ]),
    ).toEqual({
      result: 'The destination is not at a Markdown block boundary',
      body: markdown,
    })
  })

  it('resolves the moved section and seam after text is inserted before them', () => {
    const doc = new Y.Doc()
    const markdown = `# First

# Second
`
    setBody(doc, markdown)
    const move = moveBlock(doc, {
      from: markdown.indexOf('# First'),
      destination: markdown.length,
    })._unsafeUnwrap()
    const intro = `# Intro

`
    doc.getText('body').insert(0, intro)
    const undo = reverseBlockMove(doc, move)._unsafeUnwrap()

    expect(
      Object.fromEntries([
        ['body', readBody(doc)],
        ['userEvent', undo.annotations[1].value],
      ]),
    ).toEqual({
      body: `# Intro

# First

# Second
`,
      userEvent: 'undo',
    })
  })

  it('moves a heading under another heading and reverses it as an undo event', () => {
    const doc = new Y.Doc()
    const markdown = `# Parent

# Sibling

# Moved

## Child
`
    setBody(doc, markdown)
    const parentFrom = markdown.indexOf('# Parent')
    const movedFrom = markdown.indexOf('# Moved')
    const siblingFrom = markdown.indexOf('# Sibling')
    const result = moveBlock(doc, {
      from: movedFrom,
      destination: siblingFrom,
      childOf: parentFrom,
    })
    const move = result.match(
      (value) => value,
      (error) => {
        throw new Error(error.message)
      },
    )
    const afterMove = readBody(doc)
    const editorState = EditorState.create({ doc: markdown })
    const editorMove = editorState.update({
      changes: { from: 0, to: markdown.length, insert: afterMove },
      annotations: move.annotations,
    })
    const reverse = reverseBlockMove(doc, move)
    const reverseMove = reverse.match(
      (value) => value,
      (error) => {
        throw new Error(error.message)
      },
    )
    const editorUndo = editorMove.state.update({
      changes: {
        from: 0,
        to: afterMove.length,
        insert: readBody(doc),
      },
      annotations: reverseMove.annotations,
    })

    expect(
      Object.fromEntries([
        ['afterMove', afterMove],
        ['afterUndo', readBody(doc)],
        ['move', move.annotations.map((annotation) => annotation.value)],
        ['undo', reverseMove.annotations.map((annotation) => annotation.value)],
        ['undoEvent', reverseMove.annotations[1].value],
        ['editorUndoEvent', editorUndo.annotation(Transaction.userEvent)],
        ['editorUndoAnnotation', editorUndo.annotation(blockMoved)],
      ]),
    ).toEqual({
      afterMove: `# Parent

## Moved

### Child

# Sibling
`,
      afterUndo: markdown,
      move: [{ from: 10, to: 30, seam: 41 }, 'move'],
      undo: [{ from: 21, to: 39, seam: 10 }, 'undo'],
      undoEvent: 'undo',
      editorUndoEvent: 'undo',
      editorUndoAnnotation: { from: 21, to: 39, seam: 10 },
    })
  })

  it('reverses a same-position heading level change twice', () => {
    const doc = new Y.Doc()
    const markdown = `# H3

# H4
`
    setBody(doc, markdown)
    const parentFrom = markdown.indexOf('# H3')
    const movedFrom = markdown.indexOf('# H4')
    const move = moveBlock(doc, {
      from: movedFrom,
      destination: movedFrom,
      childOf: parentFrom,
    })._unsafeUnwrap()
    const afterMove = readBody(doc)
    const undo = reverseBlockMove(doc, move)._unsafeUnwrap()
    const afterUndo = readBody(doc)
    const redo = reverseBlockMove(doc, undo)._unsafeUnwrap()

    expect(
      Object.fromEntries([
        ['afterMove', afterMove],
        ['afterUndo', afterUndo],
        ['afterRedo', readBody(doc)],
        ['undoEvent', undo.annotations[1].value],
        ['redoEvent', redo.annotations[1].value],
      ]),
    ).toEqual({
      afterMove: `# H3

## H4
`,
      afterUndo: markdown,
      afterRedo: `# H3

## H4
`,
      undoEvent: 'undo',
      redoEvent: 'undo',
    })
  })

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

  it('observes memo changes and stops after unsubscribe', () => {
    const doc = new Y.Doc()
    const snapshots: string[][] = []
    const stopObserving = observeMemos(doc, () => {
      snapshots.push(
        listMemos(doc).map((memo) => `${memo.id}:${memo.state.kind}`),
      )
    })

    addMemo(doc, { id: 'memo-a', text: 'first memo', order: 0 })
    dismissMemo(doc, 'memo-a')
    stopObserving()
    restoreMemo(doc, 'memo-a')

    expect(snapshots).toEqual([['memo-a:unorganized'], ['memo-a:dismissed']])
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

    const body = getBody(doc)
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
