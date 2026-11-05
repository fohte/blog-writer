import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  getMoveConflicts,
  moveBlock,
  readBody,
  resolveMoveConflict,
  setBody,
} from '#article/index'
import {
  initialBody,
  pull,
  replica,
  settle,
  syncBoth,
} from '#article/move-conflicts.test-support'

type TestReplica = ReturnType<typeof replica>

let seed = 12345

function random(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

function randomInteger(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}

function pick<T>(values: readonly [T, ...T[]]): T {
  return values[randomInteger(0, values.length - 1)] ?? values[0]
}

function sectionRange(markdown: string): [number, number] {
  const from = markdown.indexOf('## Fjord\n')
  const next = markdown.indexOf('\n## Vista', from + 1)
  return [from, next < 0 ? markdown.length : next + 1]
}

function syncAll(replicas: TestReplica[]): void {
  for (const source of replicas) {
    for (const destination of replicas) {
      if (source !== destination) pull(destination.doc, source.doc)
    }
  }
}

function insertInsideSection(replica: TestReplica): void {
  const text = replica.doc.getText('body')
  const markdown = text.toJSON()
  const [from, to] = sectionRange(markdown)
  const bodyFrom = markdown.indexOf('\n', from) + 1
  const bodyTo = Math.max(bodyFrom, to - 1)
  const position = randomInteger(bodyFrom, bodyTo)
  text.insert(position, pick(['p', 'q', 'rs', ' ', 'uv']))
}

function deleteInsideSection(replica: TestReplica): void {
  const text = replica.doc.getText('body')
  const markdown = text.toJSON()
  const [from, to] = sectionRange(markdown)
  const bodyFrom = markdown.indexOf('\n', from) + 1
  const bodyTo = Math.max(bodyFrom, to - 1)
  if (bodyTo - bodyFrom < 2) return
  const start = randomInteger(bodyFrom, bodyTo - 2)
  const length = randomInteger(1, Math.min(4, bodyTo - start - 1))
  text.delete(start, length)
}

function insertOutsideSection(replica: TestReplica): void {
  const markdown = readBody(replica.doc)
  const locations: [number, number] = [
    markdown.indexOf('a1') + 1,
    markdown.indexOf('z9') + 1,
  ]
  replica.doc.getText('body').insert(pick(locations), 'o')
}

function moveSection(doc: Y.Doc, destination: 'top' | 'end'): void {
  const markdown = readBody(doc)
  const from = markdown.indexOf('## Fjord\n')
  moveBlock(doc, {
    from,
    destination: destination === 'top' ? 0 : markdown.length,
  })._unsafeUnwrap()
}

function linearizedResult(
  text: string,
  destinations: ('top' | 'end')[],
): string {
  const doc = new Y.Doc()
  setBody(doc, text)
  for (const destination of destinations) moveSection(doc, destination)
  return readBody(doc)
}

function randomTrial(
  trial: number,
  chained: boolean,
): {
  converged: boolean
  detectionsAgree: boolean
  conflictsCleared: boolean
  matchesLinearizedResult: boolean
  detail: string | null
} {
  const A = replica(101)
  const B = replica(102)
  const C = replica(103)
  const D = replica(104)
  const S = new Y.Doc()
  S.clientID = 105
  const all = [A, B, C, D]
  A.doc.getText('body')
  setBody(A.doc, initialBody)
  syncAll(all)

  const online: [TestReplica, ...TestReplica[]] = [A, C, D]
  for (let count = randomInteger(4, 8); count > 0; count -= 1) {
    const editor = pick(online)
    if (random() < 0.7) insertInsideSection(editor)
    else deleteInsideSection(editor)
    syncAll(all)
  }

  for (let count = randomInteger(1, 4); count > 0; count -= 1) {
    const editor = random() < 0.7 ? insertInsideSection : deleteInsideSection
    editor(B)
  }
  if (random() < 0.3) insertOutsideSection(A)
  if (random() < 0.3) insertOutsideSection(B)

  const reference = new Y.Doc()
  const offline = new Y.Doc()
  Y.applyUpdate(reference, Y.encodeStateAsUpdate(A.doc))
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(B.doc))
  Y.applyUpdate(reference, Y.encodeStateAsUpdate(offline))
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(reference))
  const destinations: ('top' | 'end')[] = [pick(['top', 'end'])]
  if (chained) destinations.push(destinations[0] === 'top' ? 'end' : 'top')
  const expected = linearizedResult(readBody(reference), destinations)

  for (const destination of destinations) moveSection(A.doc, destination)
  syncBoth(A.doc, S)
  const order = pick(['ab', 'ba', 'sa', 'sb'] as const)
  if (order === 'ab') {
    pull(B.doc, A.doc)
    pull(A.doc, B.doc)
  } else if (order === 'ba') {
    pull(A.doc, B.doc)
    pull(B.doc, A.doc)
  } else if (order === 'sa') {
    syncBoth(A.doc, S)
    syncBoth(B.doc, S)
  } else {
    syncBoth(B.doc, S)
    syncBoth(A.doc, S)
  }

  const replicas = { A, B, S, peers: [C, D] }
  settle(replicas)
  const detections = [A, B, C, D].map((editor) =>
    getMoveConflicts(editor.doc)
      .map(({ from, to, target, text }) => ({ from, to, target, text }))
      .toSorted((left, right) => left.from - right.from),
  )
  const detectionsAgree = detections.every(
    (detection) => JSON.stringify(detection) === JSON.stringify(detections[0]),
  )

  for (let pass = 0; pass < 100; pass += 1) {
    const conflicts = getMoveConflicts(A.doc)
    if (conflicts.length === 0) break
    for (const conflict of conflicts.toReversed()) {
      const current = getMoveConflicts(A.doc).find(
        ({ id }) => id === conflict.id,
      )
      if (current) {
        const result = importResolve(A.doc, current.id)
        if (result === 'error') break
      }
    }
  }
  settle(replicas)

  const docs = [A.doc, B.doc, C.doc, D.doc, S]
  const bodies = docs.map(readBody)
  const converged = bodies.every((body) => body === bodies[0])
  const conflictsCleared = [A, B, C, D].every(
    (editor) => getMoveConflicts(editor.doc).length === 0,
  )
  const matchesLinearizedResult = bodies.every((body) => body === expected)
  const detail =
    converged && detectionsAgree && conflictsCleared && matchesLinearizedResult
      ? null
      : JSON.stringify({ trial, order, chained, expected, bodies, detections })

  for (const editor of all) editor.stop()
  return {
    converged,
    detectionsAgree,
    conflictsCleared,
    matchesLinearizedResult,
    detail,
  }
}

function importResolve(doc: Y.Doc, id: string): 'ok' | 'error' {
  return resolveMoveConflict(doc, id, 'move').match(
    () => 'ok',
    () => 'error',
  )
}

describe('random move and edit sequences', () => {
  it('matches the linearized result across 800 deterministic scenarios', () => {
    seed = 12345
    const totals = {
      cases: 800,
      converged: 0,
      detectionsAgree: 0,
      conflictsCleared: 0,
      matchesLinearizedResult: 0,
    }
    let firstFailure: string | null = null
    for (let index = 0; index < 800; index += 1) {
      const result = randomTrial(index, index >= 400)
      if (result.converged) totals.converged += 1
      if (result.detectionsAgree) totals.detectionsAgree += 1
      if (result.conflictsCleared) totals.conflictsCleared += 1
      if (result.matchesLinearizedResult) totals.matchesLinearizedResult += 1
      firstFailure ??= result.detail
    }

    expect(
      Object.fromEntries([
        ['totals', totals],
        ['firstFailure', firstFailure],
      ]),
    ).toEqual({
      totals: {
        cases: 800,
        converged: 800,
        detectionsAgree: 800,
        conflictsCleared: 800,
        matchesLinearizedResult: 800,
      },
      firstFailure: null,
    })
  })
})
