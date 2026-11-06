import { afterEach, describe, expect, it } from 'vitest'

import {
  getMoveConflicts,
  moveBlock,
  readBody,
  resolveMoveConflict,
  setBody,
} from '#article/index'
import {
  pull,
  type Replica,
  replica,
  settle,
} from '#article/move-conflicts.test-support.test'

const baseBody =
  '## Cedar\na1\n## Fjord\nmaple maple\n## Vista\nz9\n## Harbor\nr3\n'
const activeReplicas: Replica[] = []

function makeReplica(clientId: number): Replica {
  const created = replica(clientId)
  activeReplicas.push(created)
  return created
}

function settleAll(A: Replica, B: Replica, peers: Replica[]): void {
  settle({ A, B, peers })
}

afterEach(() => {
  for (const { stop } of activeReplicas.splice(0)) stop()
})

describe('ported scenario 6 move conflicts', () => {
  it.each([
    { name: 'the mover resolves the stranded edit', fixer: 'A' },
    { name: 'the receiver resolves the stranded edit', fixer: 'B' },
  ] as const)('converges when $name after a middle move', ({ fixer }) => {
    const A = makeReplica(111)
    const B = makeReplica(112)
    const C = makeReplica(113)
    setBody(A.doc, baseBody)
    pull(B.doc, A.doc)
    pull(C.doc, A.doc)

    const aBody = A.doc.getText('body')
    aBody.insert(
      aBody.toJSON().indexOf('## Fjord\n') + '## Fjord\n'.length,
      'left ',
    )
    settleAll(A, B, [C])

    const cBody = C.doc.getText('body')
    cBody.insert(cBody.toJSON().lastIndexOf('maple'), 'right ')
    settleAll(A, B, [C])

    aBody.insert(aBody.toJSON().indexOf('## Vista\n'), 'prior\n')
    settleAll(A, B, [C])

    const rightText = cBody.toJSON()
    cBody.delete(rightText.indexOf('right ') + 1, 1)
    settleAll(A, B, [C])

    const bBody = B.doc.getText('body')
    bBody.insert(bBody.toJSON().indexOf('maple') + 'maple'.length, 'ipsum\n')
    bBody.delete(bBody.toJSON().lastIndexOf('maple') + 1, 2)
    aBody.insert(aBody.toJSON().indexOf('a1') + 2, 'o')

    const beforeMove = aBody.toJSON()
    moveBlock(A.doc, {
      from: beforeMove.indexOf('## Fjord\n'),
      destination: beforeMove.indexOf('## Harbor\n'),
    })._unsafeUnwrap()
    settleAll(A, B, [C])

    const beforeFix = {
      bodies: [readBody(A.doc), readBody(B.doc), readBody(C.doc)],
      conflicts: [
        getMoveConflicts(A.doc),
        getMoveConflicts(B.doc),
        getMoveConflicts(C.doc),
      ],
    }
    const fixerDoc = fixer === 'A' ? A.doc : B.doc
    for (let pass = 0; pass < 10; pass += 1) {
      const conflicts = getMoveConflicts(fixerDoc)
      if (conflicts.length === 0) break
      for (const conflict of conflicts.toReversed())
        resolveMoveConflict(fixerDoc, conflict.id, 'move')._unsafeUnwrap()
    }
    settleAll(A, B, [C])

    const readOutput = () => ({
      beforeFix,
      afterFix: {
        bodies: [readBody(A.doc), readBody(B.doc), readBody(C.doc)],
        conflicts: [
          getMoveConflicts(A.doc),
          getMoveConflicts(B.doc),
          getMoveConflicts(C.doc),
        ],
      },
    })
    expect(readOutput()).toEqual({
      beforeFix: {
        bodies: [
          '## Cedar\na1o\nipsum\n## Vista\nz9\n\n## Fjord\nleft maple rght mle\nprior\n\n## Harbor\nr3\n',
          '## Cedar\na1o\nipsum\n## Vista\nz9\n\n## Fjord\nleft maple rght mle\nprior\n\n## Harbor\nr3\n',
          '## Cedar\na1o\nipsum\n## Vista\nz9\n\n## Fjord\nleft maple rght mle\nprior\n\n## Harbor\nr3\n',
        ],
        conflicts: [
          [{ id: '112:0', from: 13, to: 19, text: 'ipsum\n', target: 51 }],
          [{ id: '112:0', from: 13, to: 19, text: 'ipsum\n', target: 51 }],
          [{ id: '112:0', from: 13, to: 19, text: 'ipsum\n', target: 51 }],
        ],
      },
      afterFix: {
        bodies: [
          '## Cedar\na1o\n## Vista\nz9\n\n## Fjord\nleft mapleipsum\n rght mle\nprior\n\n## Harbor\nr3\n',
          '## Cedar\na1o\n## Vista\nz9\n\n## Fjord\nleft mapleipsum\n rght mle\nprior\n\n## Harbor\nr3\n',
          '## Cedar\na1o\n## Vista\nz9\n\n## Fjord\nleft mapleipsum\n rght mle\nprior\n\n## Harbor\nr3\n',
        ],
        conflicts: [[], [], []],
      },
    })
  })
})
