import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import {
  getMoveConflicts,
  readBody,
  resolveMoveConflict,
  reverseBlockMove,
  setBody,
} from '#article/index'
import { observeMoveConflicts } from '#article/move-conflicts'
import {
  initialBody,
  moveSection,
  prepareConflict,
  pull,
  replica,
  settle,
  syncBoth,
} from '#article/move-conflicts.test-support'

const activeReplicas: Array<ReturnType<typeof replica>> = []

function makeReplica(clientId: number): ReturnType<typeof replica> {
  const result = replica(clientId)
  activeReplicas.push(result)
  return result
}

afterEach(() => {
  vi.useRealTimers()
  for (const { stop } of activeReplicas.splice(0)) stop()
})

describe('move conflict records', () => {
  it.each([
    ['move arrives before the offline edit', 'move-first'],
    ['offline edit arrives before the move', 'edit-first'],
    ['a relay applies the move before the edit', 'relay-move-first'],
    ['a relay applies the edit before the move', 'relay-edit-first'],
  ] as const)('repairs the moved copy when %s', (_name, order) => {
    const replicas = prepareConflict()
    activeReplicas.push(replicas.A, replicas.B)
    const relay = replicas.S

    if (order === 'move-first') {
      pull(replicas.B.doc, replicas.A.doc)
      pull(replicas.A.doc, replicas.B.doc)
    } else if (order === 'edit-first') {
      pull(replicas.A.doc, replicas.B.doc)
      pull(replicas.B.doc, replicas.A.doc)
    } else if (order === 'relay-move-first') {
      syncBoth(replicas.A.doc, relay)
      syncBoth(replicas.B.doc, relay)
    } else {
      syncBoth(replicas.B.doc, relay)
      syncBoth(replicas.A.doc, relay)
    }
    settle(replicas)

    const beforeResolution = {
      bodies: [readBody(replicas.A.doc), readBody(replicas.B.doc)],
      conflicts: [
        getMoveConflicts(replicas.A.doc),
        getMoveConflicts(replicas.B.doc),
      ],
    }
    const conflict = getMoveConflicts(replicas.A.doc)[0]
    if (conflict) {
      resolveMoveConflict(replicas.A.doc, conflict.id, 'move')._unsafeUnwrap()
    }
    settle(replicas)

    expect(
      Object.fromEntries([
        ['beforeResolution', beforeResolution],
        [
          'afterResolution',
          [readBody(replicas.A.doc), readBody(replicas.B.doc)],
        ],
        [
          'remainingConflicts',
          [getMoveConflicts(replicas.A.doc), getMoveConflicts(replicas.B.doc)],
        ],
        ['movedRecords', replicas.A.doc.getArray('moves').length],
        ['acknowledgements', replicas.B.doc.getMap('move-acks').size],
      ]),
    ).toEqual({
      beforeResolution: {
        bodies: [
          '## Cedar\na1\nxy## Vista\nz9\n\n## Fjord\nmaple ma\n',
          '## Cedar\na1\nxy## Vista\nz9\n\n## Fjord\nmaple ma\n',
        ],
        conflicts: [
          [{ id: '2:0', from: 12, to: 14, text: 'xy', target: 41 }],
          [{ id: '2:0', from: 12, to: 14, text: 'xy', target: 41 }],
        ],
      },
      afterResolution: [
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaplexy ma\n',
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaplexy ma\n',
      ],
      remainingConflicts: [[], []],
      movedRecords: 1,
      acknowledgements: 1,
    })
  })

  it('converges two offline edits and overlapping deletions before resolving both stray runs', () => {
    const A = makeReplica(51)
    const B = makeReplica(52)
    const C = makeReplica(53)
    const S = new Y.Doc()
    S.clientID = 54
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    pull(C.doc, A.doc)
    pull(S, A.doc)

    const bText = B.doc.getText('body')
    bText.insert(bText.toJSON().indexOf('maple') + 5, 'x1')
    bText.delete(bText.toJSON().lastIndexOf('ple'), 3)
    const cText = C.doc.getText('body')
    cText.insert(cText.toJSON().indexOf('maple'), 'y2')
    cText.delete(cText.toJSON().lastIndexOf('ple'), 3)
    moveSection(A.doc, 'end')

    syncBoth(A.doc, S)
    pull(B.doc, S)
    pull(C.doc, S)
    const replicas = { A, B, S, peers: [C] }
    settle(replicas)
    const detected = [A, B, C].map((replica) =>
      getMoveConflicts(replica.doc).toSorted((left, right) =>
        left.text.localeCompare(right.text),
      ),
    )
    for (const conflict of getMoveConflicts(B.doc).toReversed()) {
      resolveMoveConflict(B.doc, conflict.id, 'move')._unsafeUnwrap()
    }
    settle(replicas)

    expect(
      Object.fromEntries([
        ['detected', detected],
        [
          'finalBodies',
          [readBody(A.doc), readBody(B.doc), readBody(C.doc), readBody(S)],
        ],
        ['remaining', [A, B, C].map(({ doc }) => getMoveConflicts(doc))],
      ]),
    ).toEqual({
      detected: [
        [
          { id: '52:0', from: 14, to: 16, text: 'x1', target: 43 },
          { id: '53:0', from: 12, to: 14, text: 'y2', target: 38 },
        ],
        [
          { id: '52:0', from: 14, to: 16, text: 'x1', target: 43 },
          { id: '53:0', from: 12, to: 14, text: 'y2', target: 38 },
        ],
        [
          { id: '52:0', from: 14, to: 16, text: 'x1', target: 43 },
          { id: '53:0', from: 12, to: 14, text: 'y2', target: 38 },
        ],
      ],
      finalBodies: [
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\ny2maplex1 ma\n',
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\ny2maplex1 ma\n',
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\ny2maplex1 ma\n',
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\ny2maplex1 ma\n',
      ],
      remaining: [[], [], []],
    })
  })

  it('keeps a conflict attached through consecutive moves and an inverse move', () => {
    const replicas = prepareConflict()
    activeReplicas.push(replicas.A, replicas.B)
    const secondMove = moveSection(replicas.A.doc, 'top')
    reverseBlockMove(replicas.A.doc, secondMove)._unsafeUnwrap()
    const beforeSync = readBody(replicas.A.doc)
    pull(replicas.B.doc, replicas.A.doc)
    pull(replicas.A.doc, replicas.B.doc)
    settle(replicas)

    const conflicts = getMoveConflicts(replicas.A.doc)
    const current = readBody(replicas.A.doc)
    expect(
      Object.fromEntries([
        ['beforeSync', beforeSync],
        ['conflicts', conflicts],
        ['current', current],
        ['recordCount', replicas.A.doc.getArray('moves').length],
      ]),
    ).toEqual({
      beforeSync: '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaple maple\n',
      conflicts: [{ id: '2:0', from: 12, to: 14, text: 'xy', target: 41 }],
      current: '## Cedar\na1\nxy## Vista\nz9\n\n## Fjord\nmaple ma\n',
      recordCount: 3,
    })
  })

  it.each([
    {
      name: 'before the moved heading',
      position: 'section-start',
      text: 'P',
      expectedBody: '## Cedar\na1\nP## Vista\nz9\n\n## Fjord\nmaple maple\n',
      expectedConflicts: [],
    },
    {
      name: 'after the moved section',
      position: 'next-heading',
      text: 'Q',
      expectedBody: '## Cedar\na1\nQ## Vista\nz9\n\n## Fjord\nmaple maple\n',
      expectedConflicts: [
        { id: '32:0', from: 12, to: 13, text: 'Q', target: 47 },
      ],
    },
    {
      name: 'at the first body character',
      position: 'section-body',
      text: 'R',
      expectedBody: '## Cedar\na1\nR## Vista\nz9\n\n## Fjord\nmaple maple\n',
      expectedConflicts: [
        { id: '32:0', from: 12, to: 13, text: 'R', target: 35 },
      ],
    },
    {
      name: 'inside the heading',
      position: 'heading-text',
      text: 'S',
      expectedBody: '## Cedar\na1\nS## Vista\nz9\n\n## Fjord\nmaple maple\n',
      expectedConflicts: [
        { id: '32:0', from: 12, to: 13, text: 'S', target: 32 },
      ],
    },
  ])(
    'detects a boundary edit: $name',
    ({ position, text: insertionText, expectedBody, expectedConflicts }) => {
      const A = makeReplica(31)
      const B = makeReplica(32)
      setBody(A.doc, initialBody)
      pull(B.doc, A.doc)
      const text = B.doc.getText('body')
      const insertion =
        position === 'section-start'
          ? text.toJSON().indexOf('## Fjord')
          : position === 'next-heading'
            ? text.toJSON().indexOf('## Vista')
            : position === 'section-body'
              ? text.toJSON().indexOf('maple')
              : text.toJSON().indexOf('Fjord') + 3
      text.insert(insertion, insertionText)
      moveSection(A.doc, 'end')
      pull(B.doc, A.doc)
      pull(A.doc, B.doc)
      settle({ A, B })

      expect(
        Object.fromEntries([
          ['merged', readBody(A.doc)],
          ['conflictsA', getMoveConflicts(A.doc)],
          ['conflictsB', getMoveConflicts(B.doc)],
        ]),
      ).toEqual({
        merged: expectedBody,
        conflictsA: expectedConflicts,
        conflictsB: expectedConflicts,
      })
    },
  )

  it('expires move records and their acknowledgements after thirty days', () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') })
    const A = makeReplica(41)
    const B = makeReplica(42)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    moveSection(A.doc, 'end')
    pull(B.doc, A.doc)
    pull(A.doc, B.doc)
    const ackMap = B.doc.getMap<number>('move-acks')
    vi.setSystemTime(new Date('2026-02-02T00:00:00.000Z'))
    getMoveConflicts(B.doc)
    pull(A.doc, B.doc)
    getMoveConflicts(A.doc)

    expect(
      Object.fromEntries([
        ['conflicts', getMoveConflicts(B.doc)],
        ['records', A.doc.getArray('moves').length],
        ['acknowledgements', ackMap.size],
      ]),
    ).toEqual({
      conflicts: [],
      records: 0,
      acknowledgements: 0,
    })
  })

  it('notifies the editor when acknowledgements change without a body update', () => {
    const { doc } = makeReplica(43)
    let refreshCount = 0
    const stop = observeMoveConflicts(doc, () => {
      refreshCount += 1
    })
    doc.getMap<number>('move-acks').set('move/client', 1)
    stop()

    const readOutput = () => ({ refreshCount, body: readBody(doc) })
    expect(readOutput()).toEqual({ refreshCount: 1, body: '' })
  })

  it('starts acknowledgement tracking for a loaded move record', () => {
    const source = new Y.Doc()
    source.clientID = 61
    setBody(source, initialBody)
    moveSection(source, 'end')

    const loaded = new Y.Doc()
    loaded.clientID = 62
    pull(loaded, source)
    const record = loaded.getArray<{ copy: [number, number] }>('moves').get(0)
    const stop = observeMoveConflicts(loaded)
    const acknowledgementKey = `${record.copy[0].toString()}:${record.copy[1].toString()}/62`
    const acknowledgements = loaded.getMap<number>('move-acks')
    const body = loaded.getText('body')
    body.insert(body.toJSON().indexOf('maple') + 5, 'q')
    const conflicts = getMoveConflicts(loaded)
    const readOutput = () => ({
      records: loaded.getArray('moves').length,
      acknowledgements: Object.fromEntries(acknowledgements.entries()),
      expectedKey: acknowledgementKey,
      body: readBody(loaded),
      conflicts,
    })
    stop()

    expect(readOutput()).toEqual({
      records: 1,
      acknowledgements: { [acknowledgementKey]: 0 },
      expectedKey: acknowledgementKey,
      body: '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmapleq maple\n',
      conflicts: [],
    })
  })
})
