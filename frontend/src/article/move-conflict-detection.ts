import * as Y from 'yjs'

import {
  getMoveConflictEligibleRanges,
  type MoveConflictTarget,
} from '#article/move-conflict-eligibility'
import {
  findItem,
  indexInternalItems,
  indexRelocations,
  type InternalItemIndex,
  type RelocationIndex,
  sourceCandidatesFromAnchor,
  sourceOffsetFromAnchor,
  targetPositionFromIndex,
} from '#article/move-conflict-index'
import {
  coalesceIdRanges,
  getUnkeptMoveConflictRanges,
  type TrackedIdRange,
} from '#article/move-conflict-ranges'
import {
  getMoveRecords,
  indexMoveConflictDecisions,
  indexMoveConflictRestorations,
  isConcurrent,
  locate,
  recordMoveConflictRelocations,
  recordMoveConflictRestorations,
  targetFor,
  type TrackedTarget,
} from '#article/move-conflict-records'
import { type MoveRecord, moveRecordId } from '#article/move-conflict-source'
import {
  indexMoveRecordSources,
  type MoveRecordSourceIndex,
  type MoveSourceMatch,
  moveSourcesAt,
} from '#article/move-conflict-source-index'
import {
  type InternalItem,
  internalItems,
  MOVE_CONFLICT_TRANSACTION_ORIGIN,
  type TrackedId,
} from '#article/yjs-internals'

export type MoveConflict = {
  id: string
  from: number
  to: number
  text: string
  target: number
}

type MoveConflictDetail = {
  conflict: MoveConflict
  decisionRanges: TrackedIdRange[]
  recordId: string
  target: TrackedTarget
}

type RelocationMoveCandidate = {
  record: MoveRecord
  recordOrder: number
  relocationOnly: true
}

type MoveRecordCandidate = MoveSourceMatch | RelocationMoveCandidate

function idEqual(left: TrackedId, right: TrackedId): boolean {
  return left.client === right.client && left.clock === right.clock
}

function decisionRangeForItem(item: InternalItem): TrackedIdRange {
  return { ...item.id, length: item.length }
}

function isItemRestored(
  restorations: Map<string, TrackedIdRange[]>,
  recordId: string,
  item: InternalItem,
): boolean {
  return (restorations.get(recordId) ?? []).some(
    (range) =>
      range.client === item.id.client &&
      item.id.clock < range.clock + range.length &&
      range.clock < item.id.clock + item.length,
  )
}

function targetFromAnchor(
  doc: Y.Doc,
  records: MoveRecord[],
  sourceIndex: MoveRecordSourceIndex,
  relocations: RelocationIndex,
  restorations: Map<string, TrackedIdRange[]>,
  item: InternalItem,
  anchor: TrackedId | null,
  side: 'before' | 'after',
  index: InternalItemIndex,
): MoveConflictTarget | undefined {
  if (!anchor) return undefined
  const candidates = sourceCandidatesFromAnchor(
    sourceIndex,
    anchor,
    side,
    index,
  )
  const candidatesByRecord = new Map<string, MoveRecordCandidate>(
    candidates.map((candidate) => [moveRecordId(candidate.record), candidate]),
  )
  const relocatedAnchors =
    relocations.get(`${anchor.client.toString()}:${anchor.clock.toString()}`) ??
    new Map<string, TrackedId>()
  for (const recordId of relocatedAnchors.keys()) {
    if (!candidatesByRecord.has(recordId)) {
      const recordOrder = records.findIndex(
        (record) => moveRecordId(record) === recordId,
      )
      const record = records[recordOrder]
      if (record && recordOrder >= 0) {
        candidatesByRecord.set(recordId, {
          record,
          recordOrder,
          relocationOnly: true,
        })
      }
    }
  }
  const orderedCandidates = [...candidatesByRecord.values()].toSorted(
    (left, right) => left.recordOrder - right.recordOrder,
  )
  for (const candidate of orderedCandidates) {
    const record = candidate.record
    if (item.id.client === record.copy[0]) {
      continue
    }
    const itemSourceOffset = locate(record, item.id.client, item.id.clock)
    if (itemSourceOffset !== undefined) continue
    const recordId = moveRecordId(record)
    const relocatedAnchor = relocatedAnchors.get(recordId)
    if (relocatedAnchor) {
      const laterSource = moveSourcesAt(
        sourceIndex,
        relocatedAnchor.client,
        relocatedAnchor.clock,
      )[0]
      const laterMove = laterSource?.record
      const laterOffset = laterSource?.sourceOffset
      const mapped =
        laterMove && laterOffset !== undefined
          ? targetFor(records, laterMove, laterOffset)
          : relocatedAnchor
      if (mapped) {
        const target: TrackedTarget = { ...mapped, side }
        const position = targetPositionFromIndex(index, target)
        if (position !== undefined)
          return {
            target,
            position,
            recordId,
            eligibility: 'all',
          }
      }
      continue
    }
    if ('relocationOnly' in candidate) continue
    const sourceOffset = candidate.sourceOffset
    const includeConcurrent = side === 'after' || sourceOffset > 0
    const concurrent =
      includeConcurrent &&
      isConcurrent(doc, record, item.id.client, item.id.clock)
    const restored = isItemRestored(restorations, recordId, item)
    if (!concurrent && !restored) continue

    const mapped = targetFor(records, record, sourceOffset)
    if (mapped) {
      const target: TrackedTarget =
        side === 'before' ? { ...mapped, side: 'before' } : mapped
      const position = targetPositionFromIndex(index, target)
      if (position === undefined) continue
      return {
        target,
        position,
        recordId: moveRecordId(record),
        eligibility: includeConcurrent
          ? 'concurrent-or-restored'
          : 'restored-only',
      }
    }
  }
  return undefined
}

function targetPosition(doc: Y.Doc, target: TrackedTarget): number | undefined {
  const text = doc.getText('body')
  let position = 0
  for (const item of internalItems(text)) {
    if (
      item.id.client === target.client &&
      target.clock >= item.id.clock &&
      target.clock < item.id.clock + item.length
    ) {
      const offset = target.clock - item.id.clock
      return item.deleted
        ? position
        : position + offset + (target.side === 'after' ? 1 : 0)
    }
    if (!item.deleted && item.countable) position += item.length
  }
  return undefined
}

export function detectMoveConflictDetails(doc: Y.Doc): MoveConflictDetail[] {
  const text = doc.getText('body')
  const records = getMoveRecords(doc).toArray()
  const recordsById = new Map(
    records.map((record) => [moveRecordId(record), record]),
  )
  const sourceIndex = indexMoveRecordSources(records)
  const relocations = indexRelocations(doc, records)
  const itemIndex = indexInternalItems(text, sourceIndex)
  const decisions = indexMoveConflictDecisions(doc)
  const restorations = indexMoveConflictRestorations(doc)
  const tainted = new Map<InternalItem, MoveConflictTarget>()
  const ranges: Array<{
    from: number
    to: number
    target: TrackedTarget
    targetPosition: number
    id: string
    recordId: string
    decisionRanges: TrackedIdRange[]
  }> = []
  let position = 0
  let last: (typeof ranges)[number] | undefined

  for (const item of itemIndex.items) {
    const originTarget = targetFromAnchor(
      doc,
      records,
      sourceIndex,
      relocations,
      restorations,
      item,
      item.origin,
      'after',
      itemIndex,
    )
    const rightOriginTarget = targetFromAnchor(
      doc,
      records,
      sourceIndex,
      relocations,
      restorations,
      item,
      item.rightOrigin,
      'before',
      itemIndex,
    )
    let target = originTarget ?? rightOriginTarget
    if (!target) {
      for (const anchor of [item.origin, item.rightOrigin]) {
        if (!anchor) continue
        const anchorItem = findItem(itemIndex, anchor)
        const taintedTarget = anchorItem ? tainted.get(anchorItem) : undefined
        if (!taintedTarget) continue
        const record = recordsById.get(taintedTarget.recordId)
        if (
          record &&
          (isConcurrent(doc, record, item.id.client, item.id.clock) ||
            isItemRestored(restorations, taintedTarget.recordId, item))
        ) {
          target = {
            ...taintedTarget,
            eligibility:
              taintedTarget.eligibility === 'all'
                ? 'all'
                : 'concurrent-or-restored',
          }
        }
        if (target) break
      }
    }

    if (target) tainted.set(item, target)
    if (item.deleted || !item.countable) continue
    if (!target) {
      last = undefined
      position += item.length
      continue
    }
    let lastOffset = 0
    const eligibleRanges = getMoveConflictEligibleRanges(
      doc,
      decisionRangeForItem(item),
      recordsById.get(target.recordId),
      target,
      restorations.get(target.recordId) ?? [],
    )
    for (const eligibleRange of eligibleRanges) {
      for (const decisionRange of getUnkeptMoveConflictRanges(
        decisions,
        target.recordId,
        eligibleRange,
      )) {
        const offset = decisionRange.clock - item.id.clock
        const from = position + offset
        const to = from + decisionRange.length
        if (offset > lastOffset) last = undefined
        if (
          last &&
          last.to === from &&
          idEqual(last.target, target.target) &&
          last.target.side === target.target.side &&
          last.recordId === target.recordId
        ) {
          last.to = to
          last.decisionRanges.push(decisionRange)
        } else {
          last = {
            from,
            to,
            target: target.target,
            targetPosition: target.position,
            id: `${decisionRange.client.toString()}:${decisionRange.clock.toString()}`,
            recordId: target.recordId,
            decisionRanges: [decisionRange],
          }
          ranges.push(last)
        }
        lastOffset = offset + decisionRange.length
      }
    }
    if (lastOffset < item.length) last = undefined
    position += item.length
  }

  const markdown = text.toJSON()
  return ranges.map((range) => ({
    conflict: {
      id: range.id,
      from: range.from,
      to: range.to,
      text: markdown.slice(range.from, range.to),
      target: range.targetPosition,
    },
    decisionRanges: coalesceIdRanges(range.decisionRanges),
    recordId: range.recordId,
    target: range.target,
  }))
}

// Pass snapshots from immediately before and after undo; all new body IDs in the interval are examined as restoration candidates.
export function recordMoveConflictRestoration(
  doc: Y.Doc,
  beforeState: ReadonlyMap<number, number>,
  afterState: ReadonlyMap<number, number>,
): void {
  const text = doc.getText('body')
  const records = getMoveRecords(doc).toArray()
  if (records.length === 0) return
  const addedRanges = coalesceIdRanges(
    [...afterState].flatMap(([client, end]) => {
      const start = beforeState.get(client) ?? 0
      return start < end ? [{ client, clock: start, length: end - start }] : []
    }),
  )
  if (addedRanges.length === 0) return
  const sourceIndex = indexMoveRecordSources(records)
  const index = indexInternalItems(text)
  const restorations: Array<{ recordId: string; range: TrackedIdRange }> = []

  const rangesByClient = new Map<number, TrackedIdRange[]>()
  for (const range of addedRanges) {
    const ranges = rangesByClient.get(range.client) ?? []
    ranges.push(range)
    rangesByClient.set(range.client, ranges)
  }

  for (const item of index.items) {
    if (item.deleted || !item.countable) continue
    const itemEnd = item.id.clock + item.length
    for (const range of rangesByClient.get(item.id.client) ?? []) {
      const startClock = Math.max(range.clock, item.id.clock)
      const endClock = Math.min(range.clock + range.length, itemEnd)
      if (startClock >= endClock) continue

      const candidates = new Map<number, MoveSourceMatch>()
      if (item.origin) {
        for (const candidate of sourceCandidatesFromAnchor(
          sourceIndex,
          item.origin,
          'after',
          index,
        )) {
          candidates.set(candidate.recordOrder, candidate)
        }
      }
      if (item.rightOrigin) {
        for (const candidate of sourceCandidatesFromAnchor(
          sourceIndex,
          item.rightOrigin,
          'before',
          index,
        )) {
          candidates.set(candidate.recordOrder, candidate)
        }
      }

      for (const candidate of candidates.values()) {
        const { record } = candidate
        // The mover's own undo restores its moved text as an intentional inverse move.
        if (
          item.id.client === record.copy[0] ||
          locate(record, item.id.client, startClock) !== undefined
        ) {
          continue
        }
        const sourceOffsets = [
          ...(item.origin
            ? [sourceOffsetFromAnchor(record, item.origin, 'after', index)]
            : []),
          ...(item.rightOrigin
            ? [
                sourceOffsetFromAnchor(
                  record,
                  item.rightOrigin,
                  'before',
                  index,
                ),
              ]
            : []),
        ]
        const sourceOffset = sourceOffsets.find(
          (offset) =>
            offset !== undefined &&
            targetFor(records, record, offset) !== undefined,
        )
        if (sourceOffset === undefined) continue
        restorations.push({
          recordId: moveRecordId(record),
          range: {
            client: item.id.client,
            clock: startClock,
            length: endClock - startClock,
          },
        })
      }
    }
  }

  recordMoveConflictRestorations(doc, restorations)
}

export function resolveMoveConflictRange(
  doc: Y.Doc,
  conflict: MoveConflict,
  recordId: string,
  target: TrackedTarget,
): void {
  const text = doc.getText('body')
  const idsInRange = (from: number, to: number): TrackedId[] => {
    const ids: TrackedId[] = []
    let position = 0
    for (const item of internalItems(text)) {
      if (item.deleted || !item.countable) continue
      const start = Math.max(from - position, 0)
      const end = Math.min(to - position, item.length)
      for (let offset = start; offset < end; offset += 1) {
        ids.push({ client: item.id.client, clock: item.id.clock + offset })
      }
      position += item.length
      if (position >= to) break
    }
    return ids
  }
  doc.transact(() => {
    const sourceIds = idsInRange(conflict.from, conflict.to)
    text.delete(conflict.from, conflict.to - conflict.from)
    const targetPositionAfterDelete = targetPosition(doc, target)
    const insertion = Math.max(
      0,
      Math.min(targetPositionAfterDelete ?? conflict.target, text.length),
    )
    text.insert(insertion, conflict.text)
    const destinationIds = idsInRange(
      insertion,
      insertion + conflict.text.length,
    )
    recordMoveConflictRelocations(doc, recordId, sourceIds, destinationIds)
  }, MOVE_CONFLICT_TRANSACTION_ORIGIN)
}
