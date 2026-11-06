import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  addEvidence,
  addSource,
  deleteSource,
  getBody,
  listEvidence,
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
