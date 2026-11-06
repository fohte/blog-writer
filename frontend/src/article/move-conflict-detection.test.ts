import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import {
  getMoveConflicts,
  moveBlock,
  readBody,
  recordMoveConflictRestoration,
  resolveMoveConflict,
  setBody,
} from '#article/index'
import {
  initialBody,
  moveSection,
  prepareConflict,
  pull,
  replica,
  settle,
} from '#article/move-conflicts.test-support.test'

const activeReplicas: Array<ReturnType<typeof replica>> = []
const undoManagers: Y.UndoManager[] = []

function makeReplica(clientId: number): ReturnType<typeof replica> {
  const result = replica(clientId)
  activeReplicas.push(result)
  return result
}

function observeUndoRestorations(
  doc: Y.Doc,
  body: Y.Text,
  undoManager: Y.UndoManager,
): void {
  undoManager.on('stack-item-popped', ({ changedParentTypes }) => {
    for (const [parent, parentEvents] of changedParentTypes) {
      if (!Object.is(parent, body)) continue
      const events = parentEvents.filter(
        (event): event is Y.YTextEvent => event instanceof Y.YTextEvent,
      )
      if (events.length > 0)
        recordMoveConflictRestoration(doc, events)._unsafeUnwrap()
    }
  })
}

afterEach(() => {
  vi.useRealTimers()
  for (const undoManager of undoManagers.splice(0)) undoManager.destroy()
  for (const { stop } of activeReplicas.splice(0)) stop()
})

describe('move conflict detection', () => {
  it('reports text restored at the old location by a receiver undo', () => {
    const A = makeReplica(71)
    const B = makeReplica(72)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    const body = B.doc.getText('body')
    const undoManager = new Y.UndoManager(body, { captureTimeout: 0 })
    undoManagers.push(undoManager)
    observeUndoRestorations(B.doc, body, undoManager)

    body.delete(body.toJSON().lastIndexOf('ple'), 3)
    moveSection(A.doc, 'end')
    settle({ A, B })
    const beforeUndo = [getMoveConflicts(A.doc), getMoveConflicts(B.doc)]
    undoManager.undo()
    settle({ A, B })

    const readOutput = () => ({
      beforeUndo,
      bodies: [readBody(A.doc), readBody(B.doc)],
      conflicts: [getMoveConflicts(A.doc), getMoveConflicts(B.doc)],
    })
    expect(readOutput()).toEqual({
      beforeUndo: [[], []],
      bodies: [
        '## Cedar\na1\nple## Vista\nz9\n\n## Fjord\nmaple ma\n',
        '## Cedar\na1\nple## Vista\nz9\n\n## Fjord\nmaple ma\n',
      ],
      conflicts: [
        [{ id: '72:1', from: 12, to: 15, text: 'ple', target: 45 }],
        [{ id: '72:1', from: 12, to: 15, text: 'ple', target: 45 }],
      ],
    })
  })

  it('keeps concurrent restoration ranges from separate undo histories', () => {
    const A = makeReplica(85)
    const B = makeReplica(86)
    const C = makeReplica(87)
    const bodyText = 'AAACCC# Bbb\n# Ccc\n'
    setBody(B.doc, bodyText)
    pull(A.doc, B.doc)
    pull(C.doc, B.doc)

    const undoA = new Y.UndoManager(A.doc.getText('body'), {
      captureTimeout: 0,
    })
    const undoC = new Y.UndoManager(C.doc.getText('body'), {
      captureTimeout: 0,
    })
    undoManagers.push(undoA, undoC)
    observeUndoRestorations(A.doc, A.doc.getText('body'), undoA)
    observeUndoRestorations(C.doc, C.doc.getText('body'), undoC)
    A.doc.getText('body').delete(0, 3)
    C.doc.getText('body').delete(3, 3)
    const source = B.doc.getText('body').toJSON()
    moveBlock(B.doc, {
      from: source.indexOf('# Bbb'),
      destination: source.length,
    })._unsafeUnwrap()
    pull(A.doc, B.doc)
    pull(C.doc, B.doc)

    undoA.undo()
    undoC.undo()
    settle({ A, B, peers: [C] })

    const documents = [A.doc, B.doc, C.doc]
    const readOutput = () => ({
      bodies: documents.map(readBody),
      conflicts: documents.map((doc) =>
        getMoveConflicts(doc).map(({ text }) => text),
      ),
      restorationRecords: documents.map(
        (doc) => doc.getMap('move-conflict-restorations').size,
      ),
    })
    expect(readOutput()).toEqual({
      bodies: [
        'AAACCC# Ccc\n\n# Bbb\n',
        'AAACCC# Ccc\n\n# Bbb\n',
        'AAACCC# Ccc\n\n# Bbb\n',
      ],
      conflicts: [
        ['AAA', 'CCC'],
        ['AAA', 'CCC'],
        ['AAA', 'CCC'],
      ],
      restorationRecords: [2, 2, 2],
    })
  })

  it('rejects restoration events after the body changes again', () => {
    const A = makeReplica(88)
    const B = makeReplica(89)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    const body = B.doc.getText('body')
    const undoManager = new Y.UndoManager(body, { captureTimeout: 0 })
    undoManagers.push(undoManager)
    const undoEvents: Y.YTextEvent[] = []
    undoManager.on('stack-item-popped', ({ changedParentTypes }) => {
      for (const [parent, parentEvents] of changedParentTypes) {
        if (!Object.is(parent, body)) continue
        undoEvents.push(
          ...parentEvents.filter(
            (event): event is Y.YTextEvent => event instanceof Y.YTextEvent,
          ),
        )
      }
    })

    body.delete(body.toJSON().lastIndexOf('ple'), 3)
    moveSection(A.doc, 'end')
    settle({ A, B })
    undoManager.undo()
    const cachedDeltaCounts = undoEvents.map((event) => event.delta.length)
    body.insert(0, 'q')
    const result = recordMoveConflictRestoration(B.doc, undoEvents)

    const readOutput = () => ({
      cachedDeltaCounts,
      result: result.match(
        () => ({ ok: true, error: null }),
        (error) => ({ ok: false, error: error.message }),
      ),
    })
    expect(readOutput()).toEqual({
      cachedDeltaCounts: [2],
      result: {
        ok: false,
        error:
          'Move conflict restoration events must describe the current document state',
      },
    })
  })

  it('purges restoration ranges with their expired move record', () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') })
    const A = makeReplica(77)
    const B = makeReplica(78)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    const body = B.doc.getText('body')
    const undoManager = new Y.UndoManager(body, { captureTimeout: 0 })
    undoManagers.push(undoManager)
    observeUndoRestorations(B.doc, body, undoManager)

    body.delete(body.toJSON().lastIndexOf('ple'), 3)
    moveSection(A.doc, 'end')
    settle({ A, B })
    undoManager.undo()
    settle({ A, B })

    const beforeExpiry = [
      A.doc.getMap('move-conflict-restorations').size,
      B.doc.getMap('move-conflict-restorations').size,
    ]
    vi.setSystemTime(new Date('2026-02-02T00:00:00.000Z'))
    getMoveConflicts(A.doc)
    settle({ A, B })

    const readOutput = () => ({
      beforeExpiry,
      afterExpiry: [
        A.doc.getMap('move-conflict-restorations').size,
        B.doc.getMap('move-conflict-restorations').size,
      ],
      records: [A.doc.getArray('moves').length, B.doc.getArray('moves').length],
    })

    expect(readOutput()).toEqual({
      beforeExpiry: [1, 1],
      afterExpiry: [0, 0],
      records: [0, 0],
    })
  })

  it('reports text restored on the device that receives a remote move', () => {
    const A = makeReplica(73)
    const B = makeReplica(74)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    const body = A.doc.getText('body')
    const undoManager = new Y.UndoManager(body, { captureTimeout: 0 })
    undoManagers.push(undoManager)
    observeUndoRestorations(A.doc, body, undoManager)

    body.delete(body.toJSON().lastIndexOf('ple'), 3)
    moveSection(B.doc, 'end')
    settle({ A, B })
    const beforeUndo = [getMoveConflicts(A.doc), getMoveConflicts(B.doc)]
    undoManager.undo()
    settle({ A, B })
    const readOutput = () => ({
      beforeUndo,
      bodies: [readBody(A.doc), readBody(B.doc)],
      conflicts: [getMoveConflicts(A.doc), getMoveConflicts(B.doc)],
    })
    expect(readOutput()).toEqual({
      beforeUndo: [[], []],
      bodies: [
        '## Cedar\na1\nple## Vista\nz9\n\n## Fjord\nmaple ma\n',
        '## Cedar\na1\nple## Vista\nz9\n\n## Fjord\nmaple ma\n',
      ],
      conflicts: [
        [{ id: '73:46', from: 12, to: 15, text: 'ple', target: 45 }],
        [{ id: '73:46', from: 12, to: 15, text: 'ple', target: 45 }],
      ],
    })
  })

  it('reports a restored prefix anchored to the moved heading', () => {
    const A = makeReplica(75)
    const B = makeReplica(76)
    setBody(A.doc, 'one # Bbb\n# Ccc\n')
    pull(B.doc, A.doc)
    const body = A.doc.getText('body')
    const undoManager = new Y.UndoManager(body, { captureTimeout: 0 })
    undoManagers.push(undoManager)
    observeUndoRestorations(A.doc, body, undoManager)
    body.delete(0, 'one '.length)
    pull(B.doc, A.doc)
    const remoteBody = B.doc.getText('body').toJSON()
    moveBlock(B.doc, {
      from: remoteBody.indexOf('# Bbb'),
      destination: remoteBody.length,
    })._unsafeUnwrap()
    settle({ A, B })
    const beforeUndo = [getMoveConflicts(A.doc), getMoveConflicts(B.doc)]
    undoManager.undo()
    settle({ A, B })
    const readOutput = () => ({
      beforeUndo,
      bodies: [readBody(A.doc), readBody(B.doc)],
      conflicts: [getMoveConflicts(A.doc), getMoveConflicts(B.doc)],
    })
    expect(readOutput()).toEqual({
      beforeUndo: [[], []],
      bodies: ['one # Ccc\n\n# Bbb\n', 'one # Ccc\n\n# Bbb\n'],
      conflicts: [
        [{ id: '75:17', from: 0, to: 4, text: 'one ', target: 11 }],
        [{ id: '75:17', from: 0, to: 4, text: 'one ', target: 11 }],
      ],
    })
  })

  it('keeps repair and conflict resolution transactions out of UndoManager history', () => {
    const A = makeReplica(81)
    const B = makeReplica(82)
    setBody(A.doc, initialBody)
    pull(B.doc, A.doc)
    const body = B.doc.getText('body')
    const repairUndoManager = new Y.UndoManager(body, { captureTimeout: 0 })
    undoManagers.push(repairUndoManager)
    body.delete(body.toJSON().lastIndexOf('ple'), 3)
    const historyBeforeRepair = repairUndoManager.undoStack.length
    moveSection(A.doc, 'end')
    settle({ A, B })
    const historyAfterRepair = repairUndoManager.undoStack.length

    const conflictReplicas = prepareConflict()
    activeReplicas.push(conflictReplicas.A, conflictReplicas.B)
    settle(conflictReplicas)
    const conflict = getMoveConflicts(conflictReplicas.B.doc)[0]
    const resolutionUndoManager = new Y.UndoManager(
      conflictReplicas.B.doc.getText('body'),
      { captureTimeout: 0 },
    )
    undoManagers.push(resolutionUndoManager)
    if (conflict)
      resolveMoveConflict(
        conflictReplicas.B.doc,
        conflict.id,
        'move',
      )._unsafeUnwrap()

    const readOutput = () => ({
      repairHistory: [historyBeforeRepair, historyAfterRepair],
      resolvedConflictId: conflict?.id,
      resolutionHistory: resolutionUndoManager.undoStack.length,
    })
    expect(readOutput()).toEqual({
      repairHistory: [1, 1],
      resolvedConflictId: '2:0',
      resolutionHistory: 0,
    })
  })
})
