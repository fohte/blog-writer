import * as Y from 'yjs'

import { moveBlock, readBody, setBody } from '#article/index'
import type { MoveBlockResult } from '#article/move-block'
import { observeMoveConflicts } from '#article/move-conflicts'

export const initialBody = '## Cedar\na1\n## Fjord\nmaple maple\n## Vista\nz9\n'

export type Replica = { doc: Y.Doc; stop: () => void }
export type ReplicaSet = {
  A: Replica
  B: Replica
  S?: Y.Doc
  peers?: Replica[]
}
export type RelayedReplicaSet = ReplicaSet & { S: Y.Doc }

export function replica(clientId: number): Replica {
  const doc = new Y.Doc()
  doc.clientID = clientId
  return { doc, stop: observeMoveConflicts(doc) }
}

export function pull(destination: Y.Doc, source: Y.Doc): void {
  Y.applyUpdate(
    destination,
    Y.encodeStateAsUpdate(source, Y.encodeStateVector(destination)),
    'remote',
  )
}

export function syncBoth(left: Y.Doc, right: Y.Doc): void {
  const leftUpdate = Y.encodeStateAsUpdate(left, Y.encodeStateVector(right))
  const rightUpdate = Y.encodeStateAsUpdate(right, Y.encodeStateVector(left))
  Y.applyUpdate(right, leftUpdate, 'remote')
  Y.applyUpdate(left, rightUpdate, 'remote')
}

export function settle(replicas: ReplicaSet): void {
  for (let round = 0; round < 4; round += 1) {
    if (replicas.S) {
      syncBoth(replicas.A.doc, replicas.S)
      syncBoth(replicas.B.doc, replicas.S)
    } else {
      pull(replicas.A.doc, replicas.B.doc)
      pull(replicas.B.doc, replicas.A.doc)
    }
    for (const peer of replicas.peers ?? []) {
      if (replicas.S) {
        syncBoth(peer.doc, replicas.S)
      } else {
        pull(replicas.A.doc, peer.doc)
        pull(peer.doc, replicas.A.doc)
      }
    }
  }
}

export function prepareConflict(): RelayedReplicaSet {
  const A = replica(1)
  const B = replica(2)
  const S = new Y.Doc()
  S.clientID = 3
  setBody(A.doc, initialBody)
  pull(B.doc, A.doc)
  pull(S, A.doc)

  const offlineText = B.doc.getText('body')
  offlineText.insert(offlineText.toJSON().indexOf('maple') + 5, 'xy')
  offlineText.delete(offlineText.toJSON().lastIndexOf('ple'), 3)

  moveSection(A.doc, 'end')
  return { A, B, S }
}

export function moveSection(
  doc: Y.Doc,
  destination: 'top' | 'end' | 'before-vista',
): MoveBlockResult {
  const markdown = readBody(doc)
  const from = markdown.indexOf('## Fjord\n')
  const destinationIndex =
    destination === 'top'
      ? 0
      : destination === 'end'
        ? markdown.length
        : markdown.indexOf('## Vista\n')
  return moveBlock(doc, { from, destination: destinationIndex })._unsafeUnwrap()
}
