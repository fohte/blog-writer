import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import {
  getMoveConflicts,
  moveBlock,
  readBody,
  resolveMoveConflict,
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
} from '#article/move-conflicts.test-support.test'

const activeReplicas: Array<ReturnType<typeof replica>> = []
const activeObservers: Array<() => void> = []

function readBodiesAndConflicts(documents: Y.Doc[]) {
  return {
    bodies: documents.map(readBody),
    conflicts: documents.map(getMoveConflicts),
  }
}

function makeReplica(clientId: number): ReturnType<typeof replica> {
  const result = replica(clientId)
  activeReplicas.push(result)
  return result
}

afterEach(() => {
  vi.useRealTimers()
  for (const stop of activeObservers.splice(0)) stop()
  for (const { stop } of activeReplicas.splice(0)) stop()
})

describe('move conflict review regressions', () => {
  it('replicates a keep decision and purges it with its move record', () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') })
    const replicas = prepareConflict()
    activeReplicas.push(replicas.A, replicas.B)
    pull(replicas.B.doc, replicas.A.doc)

    const conflict = getMoveConflicts(replicas.B.doc)[0]
    if (!conflict) throw new Error('Expected a move conflict')
    const record = replicas.B.doc
      .getArray<{ copy: [number, number] }>('moves')
      .get(0)
    const decisionKey = `${record.copy[0].toString()}:${record.copy[1].toString()}/${conflict.id}`
    resolveMoveConflict(replicas.B.doc, conflict.id, 'keep')._unsafeUnwrap()
    pull(replicas.A.doc, replicas.B.doc)
    pull(replicas.B.doc, replicas.A.doc)

    const beforeExpiry = {
      decisions: Object.fromEntries(
        replicas.A.doc.getMap<boolean>('move-decisions').entries(),
      ),
      conflicts: [
        getMoveConflicts(replicas.A.doc),
        getMoveConflicts(replicas.B.doc),
      ],
      records: [
        replicas.A.doc.getArray('moves').length,
        replicas.B.doc.getArray('moves').length,
      ],
    }

    vi.setSystemTime(new Date('2026-02-02T00:00:00.000Z'))
    getMoveConflicts(replicas.B.doc)
    pull(replicas.A.doc, replicas.B.doc)

    const readOutput = () => ({
      decisionKey,
      beforeExpiry,
      afterExpiry: {
        decisions: [
          replicas.A.doc.getMap<boolean>('move-decisions').size,
          replicas.B.doc.getMap<boolean>('move-decisions').size,
        ],
        conflicts: [
          getMoveConflicts(replicas.A.doc),
          getMoveConflicts(replicas.B.doc),
        ],
        records: [
          replicas.A.doc.getArray('moves').length,
          replicas.B.doc.getArray('moves').length,
        ],
      },
    })

    expect(readOutput()).toEqual({
      decisionKey,
      beforeExpiry: {
        decisions: { [decisionKey]: true },
        conflicts: [[], []],
        records: [1, 1],
      },
      afterExpiry: {
        decisions: [0, 0],
        conflicts: [[], []],
        records: [0, 0],
      },
    })
  })

  it('notifies another replica when a keep decision arrives', () => {
    const replicas = prepareConflict()
    activeReplicas.push(replicas.A, replicas.B)
    settle(replicas)

    const notifications: string[][] = []
    activeObservers.push(
      observeMoveConflicts(replicas.A.doc, () => {
        notifications.push(getMoveConflicts(replicas.A.doc).map(({ id }) => id))
      }),
    )
    const conflict = getMoveConflicts(replicas.B.doc)[0]
    if (!conflict) throw new Error('Expected a move conflict')
    resolveMoveConflict(replicas.B.doc, conflict.id, 'keep')._unsafeUnwrap()
    settle(replicas)

    const readOutput = () => ({
      notifications,
      conflicts: [
        getMoveConflicts(replicas.A.doc),
        getMoveConflicts(replicas.B.doc),
      ],
    })
    expect(readOutput()).toEqual({
      notifications: [[]],
      conflicts: [[], []],
    })
  })

  it('keeps text received after the move update when the source was not yet known', () => {
    const A = makeReplica(71)
    const B = makeReplica(72)
    const C = makeReplica(73)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    pull(C.doc, A.doc)
    const baseStateVector = Y.encodeStateVector(B.doc)

    const cText = C.doc.getText('body')
    cText.insert(cText.toJSON().indexOf('maple') + 5, 'NEW')
    const lateInsert = Y.encodeStateAsUpdate(C.doc, baseStateVector)
    pull(A.doc, C.doc)

    let moveUpdate: Uint8Array | undefined
    const captureMove = (update: Uint8Array) => {
      moveUpdate = update
    }
    A.doc.on('update', captureMove)
    moveSection(A.doc, 'end')
    A.doc.off('update', captureMove)
    if (!moveUpdate) throw new Error('Expected a move update')

    Y.applyUpdate(B.doc, moveUpdate, 'move')
    Y.applyUpdate(B.doc, lateInsert, 'late-insert')
    Y.applyUpdate(C.doc, moveUpdate, 'move')
    for (let round = 0; round < 3; round += 1) {
      pull(A.doc, B.doc)
      pull(B.doc, A.doc)
      pull(A.doc, C.doc)
      pull(C.doc, A.doc)
      pull(B.doc, C.doc)
      pull(C.doc, B.doc)
    }

    expect(readBodiesAndConflicts([A.doc, B.doc, C.doc])).toEqual({
      bodies: [
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmapleNEW maple\n',
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmapleNEW maple\n',
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmapleNEW maple\n',
      ],
      conflicts: [[], [], []],
    })
  })

  it('does not map a removed heading marker onto a surviving marker', () => {
    const A = makeReplica(81)
    const B = makeReplica(82)
    const body = '### Summit\nbody\n\n## Valley\nend\n'
    setBody(A.doc, body)
    pull(B.doc, A.doc)
    B.doc.getText('body').delete(2, 1)

    moveBlock(A.doc, {
      from: 0,
      destination: body.length,
      headingLevel: 2,
    })._unsafeUnwrap()
    pull(B.doc, A.doc)
    pull(A.doc, B.doc)

    expect(readBodiesAndConflicts([A.doc, B.doc])).toEqual({
      bodies: [
        '## Valley\nend\n\n## Summit\nbody\n',
        '## Valley\nend\n\n## Summit\nbody\n',
      ],
      conflicts: [[], []],
    })
  })

  it('preserves a newline in text moved from an offline section', () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') })
    const A = makeReplica(83)
    const B = makeReplica(84)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    const insertedText = B.doc.getText('body')
    insertedText.insert(insertedText.toJSON().indexOf('maple') + 6, 'ipsum\n')

    moveSection(A.doc, 'end')
    settle({ A, B })
    for (let pass = 0; pass < 10; pass += 1) {
      const conflict = getMoveConflicts(A.doc)[0]
      if (!conflict) break
      resolveMoveConflict(A.doc, conflict.id, 'move')._unsafeUnwrap()
    }
    settle({ A, B })

    const beforeExpiry = {
      bodies: [readBody(A.doc), readBody(B.doc)],
      conflicts: [getMoveConflicts(A.doc), getMoveConflicts(B.doc)],
      relocations: [
        A.doc.getMap('move-conflict-relocations').size,
        B.doc.getMap('move-conflict-relocations').size,
      ],
    }

    vi.setSystemTime(new Date('2026-02-02T00:00:00.000Z'))
    getMoveConflicts(A.doc)
    pull(B.doc, A.doc)
    getMoveConflicts(B.doc)
    pull(A.doc, B.doc)

    const readOutput = () => ({
      beforeExpiry,
      afterExpiry: {
        records: [
          A.doc.getArray('moves').length,
          B.doc.getArray('moves').length,
        ],
        relocations: [
          A.doc.getMap('move-conflict-relocations').size,
          B.doc.getMap('move-conflict-relocations').size,
        ],
      },
    })

    expect(readOutput()).toEqual({
      beforeExpiry: {
        bodies: [
          '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaple ipsum\nmaple\n',
          '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaple ipsum\nmaple\n',
        ],
        conflicts: [[], []],
        relocations: [6, 6],
      },
      afterExpiry: { records: [0, 0], relocations: [0, 0] },
    })
  })

  it('keeps both copies when two move records refer to the same source characters', () => {
    const A = makeReplica(91)
    const B = makeReplica(92)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)

    moveSection(A.doc, 'end')
    moveSection(B.doc, 'top')
    pull(A.doc, B.doc)
    pull(B.doc, A.doc)

    const readOutput = () => ({
      bodies: [readBody(A.doc), readBody(B.doc)],
      conflicts: [getMoveConflicts(A.doc), getMoveConflicts(B.doc)],
      records: [A.doc.getArray('moves').length, B.doc.getArray('moves').length],
    })

    expect(readOutput()).toEqual({
      bodies: [
        '## Fjord\nmaple maple\n\n## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaple maple\n',
        '## Fjord\nmaple maple\n\n## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaple maple\n',
      ],
      conflicts: [[], []],
      records: [2, 2],
    })
  })

  it('skips repair when an expired move record arrives late', () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') })
    const A = makeReplica(101)
    const B = makeReplica(102)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    const bText = B.doc.getText('body')
    bText.delete(bText.toJSON().lastIndexOf('ple'), 3)
    moveSection(A.doc, 'end')

    vi.setSystemTime(new Date('2026-02-02T00:00:00.000Z'))
    pull(B.doc, A.doc)
    pull(A.doc, B.doc)

    const readOutput = () => ({
      bodies: [readBody(A.doc), readBody(B.doc)],
      conflicts: [getMoveConflicts(A.doc), getMoveConflicts(B.doc)],
      acknowledgements: [
        A.doc.getMap('move-acks').size,
        B.doc.getMap('move-acks').size,
      ],
      records: [A.doc.getArray('moves').length, B.doc.getArray('moves').length],
    })

    expect(readOutput()).toEqual({
      bodies: [
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaple maple\n',
        '## Cedar\na1\n## Vista\nz9\n\n## Fjord\nmaple maple\n',
      ],
      conflicts: [[], []],
      acknowledgements: [0, 0],
      records: [0, 0],
    })
  })
})
