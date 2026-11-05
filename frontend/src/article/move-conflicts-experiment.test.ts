import { describe, expect, it } from 'vitest'

import {
  getMoveConflicts,
  readBody,
  resolveMoveConflict,
  setBody,
} from '#article/index'
import {
  initialBody,
  moveSection,
  pull,
  replica,
  settle,
} from '#article/move-conflicts.test-support.test'

describe('ported move-conflict experiments', () => {
  it('preserves both section copies when two devices move them at once', () => {
    const A = replica(61)
    const B = replica(62)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    moveSection(A.doc, 'end')
    moveSection(B.doc, 'top')
    pull(A.doc, B.doc)
    pull(B.doc, A.doc)
    settle({ A, B })

    const readOutput = () => ({
      bodies: [readBody(A.doc), readBody(B.doc)],
      conflicts: [getMoveConflicts(A.doc), getMoveConflicts(B.doc)],
      records: [A.doc.getArray('moves').length, B.doc.getArray('moves').length],
    })
    A.stop()
    B.stop()

    expect(readOutput()).toEqual({
      bodies: [
        '## Fjord\nmaple maple\n\n## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaple maple\n',
        '## Fjord\nmaple maple\n\n## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaple maple\n',
      ],
      conflicts: [[], []],
      records: [2, 2],
    })
  })

  it('converges when both devices choose to move the same stranded text', () => {
    const A = replica(71)
    const B = replica(72)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    const text = B.doc.getText('body')
    text.insert(text.toJSON().indexOf('maple') + 5, 'xy')
    text.delete(text.toJSON().lastIndexOf('ple'), 3)
    moveSection(A.doc, 'end')
    pull(B.doc, A.doc)
    pull(A.doc, B.doc)
    settle({ A, B })

    const conflictsBeforeResolution = [
      getMoveConflicts(A.doc),
      getMoveConflicts(B.doc),
    ]
    const id = conflictsBeforeResolution[0]?.[0]?.id
    if (id === undefined) throw new Error('Expected a move conflict')
    resolveMoveConflict(A.doc, id, 'move')._unsafeUnwrap()
    resolveMoveConflict(B.doc, id, 'move')._unsafeUnwrap()
    settle({ A, B })

    const readOutput = () => ({
      conflictsBeforeResolution,
      finalBodies: [readBody(A.doc), readBody(B.doc)],
      remainingConflicts: [getMoveConflicts(A.doc), getMoveConflicts(B.doc)],
    })
    A.stop()
    B.stop()

    expect(readOutput()).toEqual({
      conflictsBeforeResolution: [
        [{ id: '72:0', from: 12, to: 14, text: 'xy', target: 41 }],
        [{ id: '72:0', from: 12, to: 14, text: 'xy', target: 41 }],
      ],
      finalBodies: [
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaplexyxy ma\n',
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaplexyxy ma\n',
      ],
      remainingConflicts: [[], []],
    })
  })

  it.each([
    {
      name: 'before the moved heading beside a deleted character',
      insertion: 'P',
      boundary: '## Fjord',
      expectedBody: '## Cedar\naa\nP## Vista\ncc\n\n## Fjord\nbravo\n',
      expectedConflicts: [],
    },
    {
      name: 'after the moved section beside a deleted character',
      insertion: 'Q',
      boundary: '## Vista',
      expectedBody: '## Cedar\naa\nQ## Vista\ncc\n\n## Fjord\nbravo\n',
      expectedConflicts: [
        { id: '82:0', from: 12, to: 13, text: 'Q', target: 41 },
      ],
    },
  ])(
    'detects a boundary edit with a tombstone: $name',
    ({ insertion, boundary, expectedBody, expectedConflicts }) => {
      const A = replica(81)
      const B = replica(82)
      setBody(A.doc, '## Cedar\naa\nx## Fjord\nbravo\ny## Vista\ncc\n')
      const source = A.doc.getText('body')
      source.delete(source.toJSON().indexOf('y## Vista'), 1)
      source.delete(source.toJSON().indexOf('x## Fjord'), 1)
      pull(B.doc, A.doc)

      const offline = B.doc.getText('body')
      offline.insert(offline.toJSON().indexOf(boundary), insertion)
      moveSection(A.doc, 'end')
      pull(B.doc, A.doc)
      pull(A.doc, B.doc)
      settle({ A, B })

      const readOutput = () => ({
        bodies: [readBody(A.doc), readBody(B.doc)],
        conflicts: [getMoveConflicts(A.doc), getMoveConflicts(B.doc)],
      })
      A.stop()
      B.stop()

      expect(readOutput()).toEqual({
        bodies: [expectedBody, expectedBody],
        conflicts: [expectedConflicts, expectedConflicts],
      })
    },
  )

  it('does not report old text as stranded when it predates the move', () => {
    const A = replica(91)
    const B = replica(92)
    const authoredByB = B.doc.getText('body')
    authoredByB.insert(0, '## Cedar\naa\n## Fjord\nbravo\n## Vista\ncc\n')
    pull(A.doc, B.doc)
    moveSection(A.doc, 'end')
    pull(B.doc, A.doc)
    pull(A.doc, B.doc)
    settle({ A, B })

    const readOutput = () => ({
      bodies: [readBody(A.doc), readBody(B.doc)],
      conflicts: [getMoveConflicts(A.doc), getMoveConflicts(B.doc)],
    })
    A.stop()
    B.stop()

    expect(readOutput()).toEqual({
      bodies: [
        '## Cedar\naa\n## Vista\ncc\n\n## Fjord\nbravo\n',
        '## Cedar\naa\n## Vista\ncc\n\n## Fjord\nbravo\n',
      ],
      conflicts: [[], []],
    })
  })

  it('does not report ordinary typing at the old junction after the move', () => {
    const A = replica(101)
    const B = replica(102)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    moveSection(A.doc, 'end')
    settle({ A, B })

    const online = A.doc.getText('body')
    online.insert(online.toJSON().indexOf('## Vista'), 'Z')
    pull(B.doc, A.doc)
    const peer = B.doc.getText('body')
    peer.insert(peer.toJSON().indexOf('## Vista'), 'W')
    settle({ A, B })

    const readOutput = () => ({
      bodies: [readBody(A.doc), readBody(B.doc)],
      conflicts: [getMoveConflicts(A.doc), getMoveConflicts(B.doc)],
    })
    A.stop()
    B.stop()

    expect(readOutput()).toEqual({
      bodies: [
        '## Cedar\na1\nZW## Vista\nz9\n\n## Fjord\nmaple maple\n',
        '## Cedar\na1\nZW## Vista\nz9\n\n## Fjord\nmaple maple\n',
      ],
      conflicts: [[], []],
    })
  })
})
