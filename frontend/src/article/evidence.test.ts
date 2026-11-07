import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  addEvidence,
  addSource,
  deleteSource,
  getBody,
  listEvidence,
  listEvidenceOverlapping,
  moveBlock,
  pruneEvidence,
  readBody,
  reverseBlockMove,
  setBody,
} from '#article/index'

function makeSource(doc: Y.Doc): void {
  addSource(doc, {
    id: 'source-a',
    kind: 'url',
    title: '資料',
    url: 'https://example.invalid/report',
    fileName: null,
    checkedAt: '2026-02-01T00:00:00.000Z',
  })._unsafeUnwrap()
}

describe('listEvidenceOverlapping', () => {
  it('returns evidence with a strict range overlap', () => {
    const doc = new Y.Doc()
    makeSource(doc)
    setBody(doc, 'abcde')
    for (const { from, to, id, quote } of [
      { from: 0, to: 2, id: 'before', quote: 'touches before' },
      { from: 1, to: 3, id: 'overlap', quote: 'overlaps left edge' },
      { from: 2, to: 4, id: 'inside', quote: 'same range' },
      { from: 4, to: 5, id: 'after', quote: 'touches after' },
    ]) {
      addEvidence(doc, {
        id,
        from,
        to,
        claim: 'claim',
        sourceId: 'source-a',
        quote,
        verdict: 'supported',
        checkedAt: '2026-01-01T00:00:00Z',
      })._unsafeUnwrap()
    }

    const actual = listEvidenceOverlapping(doc, { from: 2, to: 4 }).map(
      (evidence) => ({ ...evidence, from: '<position>', to: '<position>' }),
    )

    expect(actual).toEqual([
      {
        checkedAt: '2026-01-01T00:00:00Z',
        claim: 'claim',
        currentClaim: 'bc',
        edited: true,
        from: '<position>',
        id: 'overlap',
        quote: 'overlaps left edge',
        sourceId: 'source-a',
        to: '<position>',
        verdict: 'supported',
      },
      {
        checkedAt: '2026-01-01T00:00:00Z',
        claim: 'claim',
        currentClaim: 'cd',
        edited: true,
        from: '<position>',
        id: 'inside',
        quote: 'same range',
        sourceId: 'source-a',
        to: '<position>',
        verdict: 'supported',
      },
    ])
    doc.destroy()
  })
})

function readSyncedOutput(first: Y.Doc, second: Y.Doc) {
  const read = (doc: Y.Doc) =>
    listEvidence(doc).map(
      ({ checkedAt, currentClaim, edited, id, quote, sourceId, verdict }) => ({
        checkedAt,
        currentClaim,
        edited,
        id,
        quote,
        sourceId,
        verdict,
      }),
    )
  return {
    first: read(first),
    second: read(second),
    nestedMap: second.getMap('evidence').get('evidence-a') instanceof Y.Map,
  }
}

function readEditOutput(doc: Y.Doc, edited: object[]) {
  return {
    edited,
    afterDelete: listEvidence(doc),
    storedEvidenceIds: [...doc.getMap('evidence').keys()],
  }
}

function readPartialMoveOutput(
  doc: Y.Doc,
  movedBody: string,
  hidden: ReturnType<typeof listEvidence>,
  storedWhileHidden: string[],
) {
  return {
    movedBody,
    hidden,
    storedWhileHidden,
    restoredBody: readBody(doc),
    restored: listEvidence(doc).map(({ currentClaim, edited, id }) => ({
      currentClaim,
      edited,
      id,
    })),
  }
}

function readReattachedOutput(
  afterMove: { currentClaim: string; edited: boolean }[],
  afterUndo: { currentClaim: string; edited: boolean }[],
) {
  return { afterMove, afterUndo }
}

function readConcurrentSourceRemovalOutput(
  doc: Y.Doc,
  visibleBeforePrune: ReturnType<typeof listEvidence>,
  storedBeforePrune: string[],
) {
  return {
    visibleBeforePrune,
    storedBeforePrune,
    visibleAfterPrune: listEvidence(doc),
    storedEvidenceIds: [...doc.getMap('evidence').keys()],
    sources: [...doc.getMap('sources').keys()],
  }
}

function readAddEvidenceOutput(
  doc: Y.Doc,
  result: ReturnType<typeof addEvidence>,
) {
  return {
    result: result.match(
      (evidence) => ({ kind: 'ok' as const, id: evidence.id }),
      (error) => ({
        kind: 'error' as const,
        name: error.name,
        message: error.message,
      }),
    ),
    evidenceIds: [...doc.getMap('evidence').keys()],
  }
}

function readDelayedBodyOutput(
  visibleBeforeBody: ReturnType<typeof listEvidence>,
  storedBeforeBody: string[],
  storedAfterPrune: string[],
  visibleAfterBody: ReturnType<typeof listEvidence>,
) {
  return {
    visibleBeforeBody,
    storedBeforeBody,
    storedAfterPrune,
    visibleAfterBody: visibleAfterBody.map(({ currentClaim, edited, id }) => ({
      currentClaim,
      edited,
      id,
    })),
  }
}

function readBoundaryMoveOutput(doc: Y.Doc) {
  return {
    body: readBody(doc),
    evidence: listEvidence(doc).map(({ currentClaim, edited, id }) => ({
      currentClaim,
      edited,
      id,
    })),
  }
}

function readPartialEvidenceOutput(
  doc: Y.Doc,
  visible: ReturnType<typeof listEvidence>,
  visibleAfterFields: ReturnType<typeof listEvidence>,
) {
  return {
    visible,
    storedEvidenceIds: [...doc.getMap('evidence').keys()],
    visibleAfterFields: visibleAfterFields.map(
      ({ currentClaim, edited, id }) => ({ currentClaim, edited, id }),
    ),
  }
}

describe('article evidence', () => {
  it.each([
    {
      name: 'empty ID',
      input: { id: '', from: 0, to: 'The result increased.'.length },
      sourceExists: true,
      duplicate: false,
      expectedError: {
        name: 'InvalidEvidenceError',
        message: 'Invalid evidence range',
      },
      expectedEvidenceIds: [],
    },
    {
      name: 'empty claim',
      input: {
        id: 'evidence-a',
        claim: '',
        from: 0,
        to: 'The result increased.'.length,
      },
      sourceExists: true,
      duplicate: false,
      expectedError: {
        name: 'InvalidEvidenceError',
        message: 'Invalid evidence range',
      },
      expectedEvidenceIds: [],
    },
    {
      name: 'empty range',
      input: { id: 'evidence-a', from: 0, to: 0 },
      sourceExists: true,
      duplicate: false,
      expectedError: {
        name: 'InvalidEvidenceError',
        message: 'Invalid evidence range',
      },
      expectedEvidenceIds: [],
    },
    {
      name: 'out-of-bounds range',
      input: {
        id: 'evidence-a',
        from: 0,
        to: 'The result increased.'.length + 1,
      },
      sourceExists: true,
      duplicate: false,
      expectedError: {
        name: 'InvalidEvidenceError',
        message: 'Invalid evidence range',
      },
      expectedEvidenceIds: [],
    },
    {
      name: 'duplicate ID',
      input: {
        id: 'evidence-a',
        from: 0,
        to: 'The result increased.'.length,
      },
      sourceExists: true,
      duplicate: true,
      expectedError: {
        name: 'InvalidEvidenceError',
        message: 'Evidence already exists',
      },
      expectedEvidenceIds: ['evidence-a'],
    },
    {
      name: 'missing source',
      input: {
        id: 'evidence-a',
        sourceId: 'source-missing',
        from: 0,
        to: 'The result increased.'.length,
      },
      sourceExists: false,
      duplicate: false,
      expectedError: {
        name: 'SourceNotFoundError',
        message: 'Source not found: source-missing',
      },
      expectedEvidenceIds: [],
    },
  ])('rejects evidence with $name', (scenario) => {
    const doc = new Y.Doc()
    const claim = 'The result increased.'
    setBody(doc, claim)
    if (scenario.sourceExists) makeSource(doc)
    const defaults = {
      id: 'evidence-a',
      from: 0,
      to: claim.length,
      claim,
      sourceId: 'source-a',
      quote: 'A supporting quote.',
      verdict: 'supported' as const,
      checkedAt: '2026-02-01T00:00:00.000Z',
    }
    const input = { ...defaults, ...scenario.input }
    if (scenario.duplicate) addEvidence(doc, input)._unsafeUnwrap()
    if (!scenario.sourceExists) input.sourceId = 'source-missing'
    const result = addEvidence(doc, input)

    expect(readAddEvidenceOutput(doc, result)).toEqual({
      result: { kind: 'error', ...scenario.expectedError },
      evidenceIds: scenario.expectedEvidenceIds,
    })
    doc.destroy()
  })

  it('syncs the evidence map and relative text range to another document', () => {
    const first = new Y.Doc({ guid: 'article-a' })
    const second = new Y.Doc({ guid: 'article-a' })
    const claim = 'The result increased.'
    setBody(first, claim)
    makeSource(first)
    addEvidence(first, {
      id: 'evidence-a',
      from: 0,
      to: claim.length,
      claim,
      sourceId: 'source-a',
      quote: 'A supporting quote.',
      verdict: 'supported',
      checkedAt: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first))

    expect(readSyncedOutput(first, second)).toEqual({
      first: [
        {
          checkedAt: '2026-02-01T00:00:00.000Z',
          currentClaim: claim,
          edited: false,
          id: 'evidence-a',
          quote: 'A supporting quote.',
          sourceId: 'source-a',
          verdict: 'supported',
        },
      ],
      second: [
        {
          checkedAt: '2026-02-01T00:00:00.000Z',
          currentClaim: claim,
          edited: false,
          id: 'evidence-a',
          quote: 'A supporting quote.',
          sourceId: 'source-a',
          verdict: 'supported',
        },
      ],
      nestedMap: true,
    })
    first.destroy()
    second.destroy()
  })

  it('keeps checked text and marks edits while removing empty ranges', () => {
    const doc = new Y.Doc()
    const claim = 'The result increased.'
    setBody(doc, claim)
    makeSource(doc)
    addEvidence(doc, {
      id: 'evidence-a',
      from: 0,
      to: claim.length,
      claim,
      sourceId: 'source-a',
      quote: 'The result increased by a small amount.',
      verdict: 'supported',
      checkedAt: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    const body = getBody(doc)
    body.delete(4, 6)
    const edited = listEvidence(doc).map(
      ({
        checkedAt,
        claim: checkedClaim,
        currentClaim,
        edited,
        id,
        quote,
        sourceId,
        verdict,
      }) => ({
        checkedAt,
        claim: checkedClaim,
        currentClaim,
        edited,
        id,
        quote,
        sourceId,
        verdict,
      }),
    )
    body.delete(0, body.length)
    pruneEvidence(doc)

    expect(readEditOutput(doc, edited)).toEqual({
      edited: [
        {
          id: 'evidence-a',
          claim,
          sourceId: 'source-a',
          quote: 'The result increased by a small amount.',
          verdict: 'supported',
          checkedAt: '2026-02-01T00:00:00.000Z',
          currentClaim: 'The  increased.',
          edited: true,
        },
      ],
      afterDelete: [],
      storedEvidenceIds: [],
    })
    doc.destroy()
  })

  it('removes evidence whose source disappears in a concurrent update', () => {
    const evidenceWriter = new Y.Doc({ guid: 'article-a' })
    const sourceRemover = new Y.Doc({ guid: 'article-a' })
    const claim = 'The result increased.'
    setBody(evidenceWriter, claim)
    makeSource(evidenceWriter)
    Y.applyUpdate(sourceRemover, Y.encodeStateAsUpdate(evidenceWriter))
    addEvidence(evidenceWriter, {
      id: 'evidence-a',
      from: 0,
      to: claim.length,
      claim,
      sourceId: 'source-a',
      quote: 'A supporting quote.',
      verdict: 'supported',
      checkedAt: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    deleteSource(sourceRemover, 'source-a')._unsafeUnwrap()
    Y.applyUpdate(evidenceWriter, Y.encodeStateAsUpdate(sourceRemover))
    const visibleBeforePrune = listEvidence(evidenceWriter)
    const storedBeforePrune = [...evidenceWriter.getMap('evidence').keys()]
    pruneEvidence(evidenceWriter)

    expect(
      readConcurrentSourceRemovalOutput(
        evidenceWriter,
        visibleBeforePrune,
        storedBeforePrune,
      ),
    ).toEqual({
      visibleBeforePrune: [],
      storedBeforePrune: ['evidence-a'],
      visibleAfterPrune: [],
      storedEvidenceIds: [],
      sources: [],
    })
    evidenceWriter.destroy()
    sourceRemover.destroy()
  })

  it('keeps evidence hidden until its referenced body arrives', () => {
    const articleId = 'article-delayed-body'
    const sourceWriter = new Y.Doc({ guid: articleId })
    addSource(sourceWriter, {
      id: 'source-a',
      kind: 'url',
      title: '資料',
      url: 'https://example.invalid/report',
      fileName: null,
      checkedAt: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    const sourceUpdate = Y.encodeStateAsUpdate(sourceWriter)
    const sourceVector = Y.encodeStateVector(sourceWriter)
    setBody(sourceWriter, 'The result increased.')
    const bodyUpdate = Y.encodeStateAsUpdate(sourceWriter, sourceVector)

    const evidenceWriter = new Y.Doc({ guid: articleId })
    Y.applyUpdate(evidenceWriter, sourceUpdate)
    Y.applyUpdate(evidenceWriter, bodyUpdate)
    const evidenceVector = Y.encodeStateVector(evidenceWriter)
    addEvidence(evidenceWriter, {
      id: 'evidence-a',
      from: 0,
      to: 'The result increased.'.length,
      claim: 'The result increased.',
      sourceId: 'source-a',
      quote: 'A supporting quote.',
      verdict: 'supported',
      checkedAt: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    const evidenceUpdate = Y.encodeStateAsUpdate(evidenceWriter, evidenceVector)

    const reader = new Y.Doc({ guid: articleId })
    Y.applyUpdate(reader, sourceUpdate)
    Y.applyUpdate(reader, evidenceUpdate)
    const visibleBeforeBody = listEvidence(reader)
    const storedBeforeBody = [...reader.getMap('evidence').keys()]
    pruneEvidence(reader)
    const storedAfterPrune = [...reader.getMap('evidence').keys()]
    Y.applyUpdate(reader, bodyUpdate)

    expect(
      readDelayedBodyOutput(
        visibleBeforeBody,
        storedBeforeBody,
        storedAfterPrune,
        listEvidence(reader),
      ),
    ).toEqual({
      visibleBeforeBody: [],
      storedBeforeBody: ['evidence-a'],
      storedAfterPrune: ['evidence-a'],
      visibleAfterBody: [
        {
          id: 'evidence-a',
          currentClaim: 'The result increased.',
          edited: false,
        },
      ],
    })
    sourceWriter.destroy()
    evidenceWriter.destroy()
    reader.destroy()
  })

  it('keeps an incomplete evidence record until its fields arrive', () => {
    const doc = new Y.Doc()
    const claim = 'The result increased.'
    setBody(doc, claim)
    makeSource(doc)
    const data = new Y.Map<unknown>()
    data.set(
      'from',
      Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(getBody(doc), 0, 1),
      ),
    )
    data.set('claim', claim)
    data.set('sourceId', 'source-a')
    doc.getMap('evidence').set('evidence-partial', data)
    const visible = listEvidence(doc)
    pruneEvidence(doc)
    doc.transact(() => {
      data.set(
        'to',
        Y.relativePositionToJSON(
          Y.createRelativePositionFromTypeIndex(getBody(doc), claim.length, -1),
        ),
      )
      data.set('verdict', 'supported')
    })

    expect(readPartialEvidenceOutput(doc, visible, listEvidence(doc))).toEqual({
      visible: [],
      storedEvidenceIds: ['evidence-partial'],
      visibleAfterFields: [
        {
          currentClaim: claim,
          edited: false,
          id: 'evidence-partial',
        },
      ],
    })
    doc.destroy()
  })

  it('keeps an evidence range at the moved section end exclusive', () => {
    const doc = new Y.Doc()
    const markdown = '# Alpha\n\nFirst sentence.\n\n# Beta\n\nFinal sentence.'
    const claim = 'Final sentence.'
    setBody(doc, markdown)
    makeSource(doc)
    const from = markdown.indexOf(claim)
    addEvidence(doc, {
      id: 'evidence-a',
      from,
      to: markdown.length,
      claim,
      sourceId: 'source-a',
      quote: 'A supporting quote.',
      verdict: 'supported',
      checkedAt: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    moveBlock(doc, {
      from: markdown.indexOf('# Beta'),
      destination: 0,
    })._unsafeUnwrap()

    expect(readBoundaryMoveOutput(doc)).toEqual({
      body: '# Beta\n\nFinal sentence.\n\n# Alpha\n\nFirst sentence.\n',
      evidence: [
        {
          id: 'evidence-a',
          currentClaim: claim,
          edited: false,
        },
      ],
    })
    doc.destroy()
  })

  it('hides a reversed range after a partial section move and restores it on undo', () => {
    const doc = new Y.Doc()
    const markdown =
      '# Alpha\n\nFirst sentence.\n\n# Beta\n\nSecond sentence.\n'
    setBody(doc, markdown)
    makeSource(doc)
    const from = markdown.indexOf('First sentence.')
    const to = markdown.indexOf('Second sentence.') + 'Second sentence.'.length
    addEvidence(doc, {
      id: 'evidence-a',
      from,
      to,
      claim: markdown.slice(from, to),
      sourceId: 'source-a',
      quote: 'A supporting quote.',
      verdict: 'supported',
      checkedAt: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    const moved = moveBlock(doc, {
      from: 0,
      destination: markdown.length,
    })._unsafeUnwrap()
    const movedBody = readBody(doc)
    const hidden = listEvidence(doc)
    const storedWhileHidden = [...doc.getMap('evidence').keys()]
    reverseBlockMove(doc, moved)._unsafeUnwrap()

    expect(
      readPartialMoveOutput(doc, movedBody, hidden, storedWhileHidden),
    ).toEqual({
      movedBody: '# Beta\n\nSecond sentence.\n\n# Alpha\n\nFirst sentence.\n',
      hidden: [],
      storedWhileHidden: ['evidence-a'],
      restoredBody: markdown,
      restored: [
        {
          id: 'evidence-a',
          currentClaim: markdown.slice(from, to),
          edited: false,
        },
      ],
    })
    doc.destroy()
  })

  it('reattaches both range ends when its section moves', () => {
    const doc = new Y.Doc()
    const markdown =
      '# Alpha\n\nFirst sentence.\n\n# Beta\n\nSecond sentence.\n'
    setBody(doc, markdown)
    makeSource(doc)
    const from = markdown.indexOf('First sentence.')
    const to = from + 'First sentence.'.length
    addEvidence(doc, {
      id: 'evidence-a',
      from,
      to,
      claim: markdown.slice(from, to),
      sourceId: 'source-a',
      quote: 'A supporting quote.',
      verdict: 'supported',
      checkedAt: '2026-02-01T00:00:00.000Z',
    })._unsafeUnwrap()
    const moved = moveBlock(doc, {
      from: 0,
      destination: markdown.length,
    })._unsafeUnwrap()
    const afterMove = listEvidence(doc).map(({ currentClaim, edited }) => ({
      currentClaim,
      edited,
    }))
    reverseBlockMove(doc, moved)._unsafeUnwrap()

    expect(
      readReattachedOutput(
        afterMove,
        listEvidence(doc).map(({ currentClaim, edited }) => ({
          currentClaim,
          edited,
        })),
      ),
    ).toEqual({
      afterMove: [{ currentClaim: 'First sentence.', edited: false }],
      afterUndo: [{ currentClaim: 'First sentence.', edited: false }],
    })
    doc.destroy()
  })
})
