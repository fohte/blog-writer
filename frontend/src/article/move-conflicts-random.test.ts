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
  pull,
  replica,
  settle,
  syncBoth,
} from '#article/move-conflicts.test-support.test'

const initialBody = '## A\naa\n## B\nbravo\n## C\ncc\n'
type TestReplica = ReturnType<typeof replica>
type Destination = 'top' | 'mid' | 'end'

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
  const from = markdown.indexOf('## B\n')
  const next = markdown.indexOf('\n## C', from + 1)
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
  const position = randomInteger(from + 5, to - 1)
  text.insert(
    position,
    pick(['xx', 'yy', 'zz', 'ab', 'Q', 'lorem ', 'ipsum\n', 'ipsum\nx', 'k']),
  )
}

function deleteInsideSection(replica: TestReplica): void {
  const text = replica.doc.getText('body')
  const markdown = text.toJSON()
  const [from, to] = sectionRange(markdown)
  if (to - 1 - (from + 5) < 1) return
  const start = randomInteger(from + 5, to - 2)
  const length = randomInteger(1, Math.min(4, to - 1 - start))
  text.delete(start, length)
}

function insertOutsideSection(replica: TestReplica): void {
  const markdown = readBody(replica.doc)
  const locations: [number, number] = [
    markdown.indexOf('aa') + 1,
    markdown.indexOf('cc') + 1,
  ]
  replica.doc.getText('body').insert(pick(locations), 'o')
}

function moveSection(doc: Y.Doc, destination: Destination): string | undefined {
  const markdown = readBody(doc)
  const from = markdown.indexOf('## B\n')
  const destinationIndex =
    destination === 'top'
      ? 0
      : destination === 'mid'
        ? markdown.indexOf('## C\n')
        : markdown.length
  return moveBlock(doc, { from, destination: destinationIndex }).match(
    () => undefined,
    (error) => error.message,
  )
}

function linearizedResult(
  markdown: string,
  destinations: Destination[],
): { body: string } | { error: { body: string; message: string } } {
  const doc = new Y.Doc()
  setBody(doc, markdown)
  for (const destination of destinations) {
    const error = moveSection(doc, destination)
    if (error !== undefined) {
      const output = { error: { body: readBody(doc), message: error } }
      doc.destroy()
      return output
    }
  }
  const output = { body: readBody(doc) }
  doc.destroy()
  return output
}

function normalizeStructuralSeams(markdown: string): string {
  return markdown.replaceAll(/\n{2,}(?=## [ABC]\n)/g, '\n').replace(/\n+$/, '')
}

function resolveAll(doc: Y.Doc): 'ok' | 'error' {
  for (let pass = 0; pass < 100; pass += 1) {
    const conflict = getMoveConflicts(doc).at(-1)
    if (!conflict) return 'ok'
    if (resolveMoveConflict(doc, conflict.id, 'move').isErr()) return 'error'
  }
  return 'error'
}

function syncForOrder(
  order: 'ab' | 'ba' | 'sa' | 'sb',
  A: TestReplica,
  B: TestReplica,
  S: Y.Doc,
): void {
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
}

function randomTrial(
  trial: number,
  chained: boolean,
): {
  converged: boolean
  strayEq: boolean
  detectionsAgree: boolean
  convergeAfterFix: boolean
  noStrayLeft: boolean
  matchesLinearizedContent: boolean
  detail: string | null
} {
  const A = replica(1)
  const B = replica(2)
  const C = replica(5)
  const D = replica(6)
  const E = replica(7)
  const S = new Y.Doc()
  S.clientID = 3
  const peers = [C, D, E]
  const all = [A, B, ...peers]
  setBody(A.doc, initialBody)
  syncAll(all)

  const online: [TestReplica, ...TestReplica[]] = [A, ...peers]
  for (let count = randomInteger(4, 12); count > 0; count -= 1) {
    const editor = pick(online)
    if (random() < 0.7) insertInsideSection(editor)
    else deleteInsideSection(editor)
    syncAll(all)
  }

  for (let count = randomInteger(1, 4); count > 0; count -= 1) {
    if (random() < 0.65) insertInsideSection(B)
    else deleteInsideSection(B)
  }
  if (random() < 0.3) insertOutsideSection(B)
  if (random() < 0.3) insertOutsideSection(A)

  const reference = new Y.Doc()
  const offline = new Y.Doc()
  Y.applyUpdate(reference, Y.encodeStateAsUpdate(A.doc))
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(B.doc))
  Y.applyUpdate(reference, Y.encodeStateAsUpdate(offline))
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(reference))

  const destinations: Destination[] = [pick(['top', 'end'])]
  if (chained) {
    destinations.push(destinations[0] === 'top' ? 'end' : pick(['top', 'mid']))
  }
  const expectedResult = linearizedResult(readBody(reference), destinations)
  if ('error' in expectedResult) {
    const detail = JSON.stringify({
      trial,
      chained,
      phase: 'linearized move',
      ...expectedResult.error,
    })
    for (const editor of all) editor.stop()
    for (const doc of [...all.map(({ doc }) => doc), S, reference, offline]) {
      doc.destroy()
    }
    return {
      converged: false,
      strayEq: false,
      detectionsAgree: false,
      convergeAfterFix: false,
      noStrayLeft: false,
      matchesLinearizedContent: false,
      detail,
    }
  }
  const expected = expectedResult.body

  for (const destination of destinations) {
    const error = moveSection(A.doc, destination)
    if (error !== undefined) {
      const detail = JSON.stringify({
        trial,
        chained,
        phase: 'actual move',
        destination,
        body: readBody(A.doc),
        error,
      })
      for (const editor of all) editor.stop()
      for (const doc of [...all.map(({ doc }) => doc), S, reference, offline]) {
        doc.destroy()
      }
      return {
        converged: false,
        strayEq: false,
        detectionsAgree: false,
        convergeAfterFix: false,
        noStrayLeft: false,
        matchesLinearizedContent: false,
        detail,
      }
    }
  }
  const order = pick(['ab', 'ba', 'sa', 'sb'] as const)
  syncForOrder(order, A, B, S)

  const replicas = { A, B, S, peers }
  settle(replicas)
  const detections = [A, B, ...peers].map((editor) =>
    getMoveConflicts(editor.doc).toSorted(
      (left, right) => left.from - right.from,
    ),
  )
  const detectionsAgree = detections.every(
    (detection) => JSON.stringify(detection) === JSON.stringify(detections[0]),
  )
  const strayEq =
    JSON.stringify(detections[0]) === JSON.stringify(detections[1])
  const docs = [...all.map(({ doc }) => doc), S]
  const beforeFixBodies = docs.map(readBody)
  const converged = beforeFixBodies.every((body) => body === beforeFixBodies[0])
  const fixer = pick([A, B])
  const resolution = resolveAll(fixer.doc)
  settle(replicas)

  const bodies = docs.map(readBody)
  const convergeAfterFix = bodies.every((body) => body === bodies[0])
  const noStrayLeft = [A, B, ...peers].every(
    (editor) => getMoveConflicts(editor.doc).length === 0,
  )
  const matchesLinearizedContent = bodies.every(
    (body) =>
      normalizeStructuralSeams(body) === normalizeStructuralSeams(expected),
  )
  const detail =
    resolution === 'ok' &&
    converged &&
    strayEq &&
    detectionsAgree &&
    convergeAfterFix &&
    noStrayLeft &&
    matchesLinearizedContent
      ? null
      : JSON.stringify({
          trial,
          order,
          chained,
          resolution,
          expected,
          bodies,
          detections,
        })

  for (const editor of all) editor.stop()
  for (const doc of [...all.map(({ doc }) => doc), S, reference, offline]) {
    doc.destroy()
  }
  return {
    converged,
    strayEq,
    detectionsAgree,
    convergeAfterFix,
    noStrayLeft,
    matchesLinearizedContent,
    detail,
  }
}

describe('random move and edit sequences', () => {
  it('converges with the same ordered text across 800 deterministic scenarios', () => {
    seed = 12345
    const makeTotals = () => ({
      cases: 400,
      converged: 0,
      strayEq: 0,
      detectionsAgree: 0,
      convergeAfterFix: 0,
      noStrayLeft: 0,
      matchesLinearizedContent: 0,
    })
    const totals = { singleMove: makeTotals(), chainedMoves: makeTotals() }
    let firstFailure: string | null = null
    for (let index = 0; index < 800; index += 1) {
      const result = randomTrial(index, index >= 400)
      const counts = index < 400 ? totals.singleMove : totals.chainedMoves
      if (result.converged) counts.converged += 1
      if (result.strayEq) counts.strayEq += 1
      if (result.detectionsAgree) counts.detectionsAgree += 1
      if (result.convergeAfterFix) counts.convergeAfterFix += 1
      if (result.noStrayLeft) counts.noStrayLeft += 1
      if (result.matchesLinearizedContent) counts.matchesLinearizedContent += 1
      firstFailure ??= result.detail
    }

    expect(
      Object.fromEntries([
        ['totals', totals],
        ['firstFailure', firstFailure],
      ]),
    ).toEqual({
      totals: {
        singleMove: {
          cases: 400,
          converged: 400,
          strayEq: 400,
          detectionsAgree: 400,
          convergeAfterFix: 400,
          noStrayLeft: 400,
          matchesLinearizedContent: 400,
        },
        chainedMoves: {
          cases: 400,
          converged: 400,
          strayEq: 400,
          detectionsAgree: 400,
          convergeAfterFix: 400,
          noStrayLeft: 400,
          matchesLinearizedContent: 400,
        },
      },
      firstFailure: null,
    })
  })
})
