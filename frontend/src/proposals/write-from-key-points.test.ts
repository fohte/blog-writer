import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { setBody } from '#article/body'
import { addSource, deleteSource, listEvidence } from '#article/index'
import { persistAcceptedEvidence } from '#proposals/write-from-key-points'

describe('persistAcceptedEvidence', () => {
  it('keeps accepted evidence when its source was removed', () => {
    const doc = new Y.Doc()
    const claim = 'The measure reached a record.'
    setBody(doc, claim)
    addSource(doc, {
      id: 'source-example',
      kind: 'url',
      title: 'Example report',
      url: 'https://example.invalid/report',
      fileName: null,
      checkedAt: '2026-03-01T00:00:00.000Z',
      summary: 'Example summary.',
    })._unsafeUnwrap()
    deleteSource(doc, 'source-example')._unsafeUnwrap()
    let disposed = false

    const result = persistAcceptedEvidence(
      doc,
      {
        sentences: [
          {
            from: 0,
            to: claim.length,
            claim,
            sourceId: 'source-example',
            quote: 'The recorded value reached a record.',
            verdict: 'supported',
          },
        ],
      },
      {
        current: () => ({ from: 0, to: claim.length }),
        dispose: () => {
          disposed = true
        },
      },
    )

    const readOutput = () => ({
      result: result.match(
        () => 'ok',
        (error) => error.name,
      ),
      evidence: listEvidence(doc).map(
        ({
          claim: savedClaim,
          currentClaim,
          edited,
          quote,
          sourceId,
          verdict,
        }) => ({
          claim: savedClaim,
          checkedAt: 'date-placeholder',
          currentClaim,
          edited,
          id: 'id-placeholder',
          quote,
          sourceId,
          verdict,
        }),
      ),
      disposed,
    })

    expect(readOutput()).toEqual({
      result: 'ok',
      evidence: [
        {
          claim,
          checkedAt: 'date-placeholder',
          currentClaim: claim,
          edited: false,
          id: 'id-placeholder',
          quote: '',
          sourceId: null,
          verdict: 'insufficient',
        },
      ],
      disposed: true,
    })
    doc.destroy()
  })
})
