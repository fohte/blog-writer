import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { moveBlock, setBody } from '#article/index'
import { moveEntryForReverseStep } from '#outline/move-history-transitions'

const docs: Y.Doc[] = []

afterEach(() => {
  for (const doc of docs.splice(0)) doc.destroy()
})

describe('move history stack transitions', () => {
  it('keeps remote validation required when a move changes stacks', () => {
    const doc = new Y.Doc()
    docs.push(doc)
    const initial = `alpha

beta
`
    setBody(doc, initial)
    const move = moveBlock(doc, {
      from: initial.indexOf('beta'),
      destination: 0,
    }).match(
      (value) => value,
      () => undefined,
    )
    if (move === undefined) throw new Error('The fixture move was rejected')

    const entry = moveEntryForReverseStep({ requiresValidation: true }, move)

    const readOutput = () => ({
      kind: entry.kind,
      move: { from: entry.move.from, to: entry.move.to, seam: entry.move.seam },
      requiresValidation: entry.requiresValidation,
    })

    expect(readOutput()).toEqual({
      kind: 'move',
      move: { from: 0, to: 5, seam: 12 },
      requiresValidation: true,
    })
  })
})
