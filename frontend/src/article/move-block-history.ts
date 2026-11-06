import { ChangeSet } from '@codemirror/state'
import { err, ok, Result } from 'neverthrow'

import { InvalidBlockMoveError } from '#article/errors'
import type { MoveBlockResult } from '#article/move-block'
import type { MoveSource, TextReplacement } from '#article/move-block-plan'
import {
  mapWithinRange,
  planBlockMove,
  transformedText,
} from '#article/move-block-plan'

export type MoveSeparator = {
  side: 'prefix' | 'suffix'
  text: string
}

export type MoveRecord = {
  insertedSelection: string
  headingLevel?: number
  contentReplacements: TextReplacement[]
  mapPosition: (position: number, assoc: number) => number | undefined
  inverse: ChangeSet
  source?: MoveSource
  separators: MoveSeparator[]
}

type MappedMoveRecord = {
  from: number
  to: number
  seam: number
  history: MoveRecord
  changeBeforeMove: ChangeSet
}

export function changeSetForMove(
  markdown: string,
  plannedMove: ReturnType<typeof planBlockMove>,
): ChangeSet {
  const { deletionFrom, removedLength, insertionIndex, insertion } = plannedMove
  const deletionTo = deletionFrom + removedLength
  const insertionFrom =
    insertionIndex < deletionFrom
      ? insertionIndex
      : insertionIndex + removedLength
  const changes =
    insertionFrom === deletionFrom
      ? [
          {
            from: deletionFrom,
            to: deletionTo,
            insert: insertion.text,
          },
        ]
      : [
          { from: deletionFrom, to: deletionTo },
          { from: insertionFrom, to: insertionFrom, insert: insertion.text },
        ].toSorted((left, right) => left.from - right.from)

  return ChangeSet.of(changes, markdown.length)
}

function findInsertedContent(
  inverse: ChangeSet,
  history: MoveRecord,
  mappedContent: string,
  oldContentLength: number,
): { from: number; length: number } | undefined {
  const candidates = history.source
    ? [history.source.text]
    : [mappedContent, mappedContent.replace(/\n+$/u, '\n')]
  const matches: { from: number; length: number }[] = []

  inverse.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
    const text = inserted.toString()
    for (const candidate of candidates) {
      if (candidate.length === 0) continue
      const at = text.indexOf(candidate)
      if (at < 0 || text.indexOf(candidate, at + 1) !== -1) continue
      matches.push({
        from: fromB + at,
        length: candidate.length,
      })
    }
  })

  const distinct = matches.filter(
    (match, index) =>
      matches.findIndex(
        (candidate) =>
          candidate.from === match.from && candidate.length === match.length,
      ) === index,
  )
  if (distinct.length !== 1) return undefined
  const match = distinct[0]
  if (!match) return undefined

  if (history.source) {
    return { from: match.from, length: history.source.text.length }
  }
  return { from: match.from, length: oldContentLength }
}

function changesTouchMoveBoundary(
  from: number,
  to: number,
  move: MoveBlockResult,
): boolean {
  const insertion = from === to
  return insertion
    ? from === move.from || from === move.to || from === move.seam
    : (from < move.from && to > move.from) ||
        (from < move.to && to > move.to) ||
        (from <= move.seam && to >= move.seam)
}

function changesTouchSeparator(
  from: number,
  to: number,
  move: MoveBlockResult,
  history: MoveRecord,
): boolean {
  return history.separators.some(({ side, text }) => {
    const separatorFrom = side === 'prefix' ? move.from - text.length : move.to
    const separatorTo = separatorFrom + text.length
    return from === to
      ? from >= separatorFrom && from <= separatorTo
      : from < separatorTo && to > separatorFrom
  })
}

function changesTouchContentReplacement(
  from: number,
  to: number,
  move: MoveBlockResult,
  history: MoveRecord,
): boolean {
  return history.contentReplacements.some((replacement) => {
    const replacementFrom = move.from + replacement.from
    const replacementTo = move.from + replacement.to
    return from === to
      ? from >= replacementFrom && from <= replacementTo
      : from < replacementTo && to > replacementFrom
  })
}

function applyChangesToString(
  value: string,
  changes: readonly { from: number; to: number; insert: string }[],
): string {
  return changes
    .toReversed()
    .reduce(
      (current, change) =>
        current.slice(0, change.from) +
        change.insert +
        current.slice(change.to),
      value,
    )
}

export function mapMoveHistoryRemote(
  move: MoveBlockResult,
  history: MoveRecord,
  change: ChangeSet,
  inverse: ChangeSet,
): Result<MappedMoveRecord, InvalidBlockMoveError> {
  if (inverse.length !== change.length) {
    return err(
      new InvalidBlockMoveError(
        'The move history no longer matches the document',
      ),
    )
  }

  const movedLength = move.to - move.from
  const oldContent = history.insertedSelection.slice(0, movedLength)
  const mappedContent = transformedText(
    oldContent,
    { from: 0, to: oldContent.length },
    history.contentReplacements,
  )
  const sourceInsertion = findInsertedContent(
    inverse,
    history,
    mappedContent,
    oldContent.length,
  )
  if (!sourceInsertion)
    return err(new InvalidBlockMoveError('The move source cannot be mapped'))

  const mapContentPosition = (position: number): number | undefined => {
    if (position === move.from) return 0
    if (position === move.to) return mappedContent.length
    const relativeReplacements = history.contentReplacements.map(
      (replacement) => ({
        ...replacement,
        from: replacement.from + move.from,
        to: replacement.to + move.from,
      }),
    )
    return mapWithinRange(
      position,
      { from: move.from, to: move.to },
      relativeReplacements,
    )
  }

  const mappedChanges: { from: number; to: number; insert: string }[] = []
  const insideChanges: { from: number; to: number; insert: string }[] = []
  let mappingError: InvalidBlockMoveError | undefined
  change.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (mappingError) return
    if (changesTouchSeparator(fromA, toA, move, history)) {
      mappingError = new InvalidBlockMoveError(
        'A remote change overlaps a moved separator',
      )
      return
    }

    const isInsideMove =
      fromA >= move.from &&
      toA <= move.to &&
      (fromA < toA || (fromA > move.from && fromA < move.to))
    if (isInsideMove) {
      if (changesTouchContentReplacement(fromA, toA, move, history)) {
        mappingError = new InvalidBlockMoveError(
          'A remote change overlaps a moved heading marker',
        )
        return
      }
      const from = mapContentPosition(fromA)
      const to = mapContentPosition(toA)
      if (from === undefined || to === undefined) {
        mappingError = new InvalidBlockMoveError(
          'A remote change overlaps a moved block boundary',
        )
        return
      }
      mappedChanges.push({
        from: sourceInsertion.from + from,
        to: sourceInsertion.from + to,
        insert: inserted.toString(),
      })
      insideChanges.push({
        from: fromA - move.from,
        to: toA - move.from,
        insert: inserted.toString(),
      })
      return
    }

    if (
      changesTouchMoveBoundary(fromA, toA, move) ||
      (fromA < move.to && toA > move.from)
    ) {
      mappingError = new InvalidBlockMoveError(
        'A remote change overlaps a moved block boundary',
      )
      return
    }
    mappedChanges.push({
      from: inverse.mapPos(fromA, -1),
      to: inverse.mapPos(toA, 1),
      insert: inserted.toString(),
    })
  })
  if (mappingError) return err(mappingError)

  mappedChanges.sort((left, right) => left.from - right.from)
  if (
    mappedChanges.some(
      (mapped, index) =>
        mapped.from < 0 ||
        mapped.to < mapped.from ||
        mapped.to > inverse.newLength ||
        (index > 0 && (mappedChanges[index - 1]?.to ?? 0) > mapped.from),
    )
  ) {
    return err(
      new InvalidBlockMoveError('Remote changes overlap after move mapping'),
    )
  }
  const changeBeforeMove = ChangeSet.of(mappedChanges, inverse.newLength)
  const contentChange = ChangeSet.of(insideChanges, movedLength)

  const mappedHistory: MoveRecord = {
    ...history,
    separators: [...history.separators],
    ...(history.source === undefined ? {} : { source: { ...history.source } }),
    contentReplacements: history.contentReplacements.map((replacement) => ({
      ...replacement,
      from: contentChange.mapPos(replacement.from, -1),
      to: contentChange.mapPos(replacement.to, 1),
    })),
  }
  if (mappedHistory.source) {
    const sourceFrom = sourceInsertion.from
    const sourceTo = sourceFrom + mappedHistory.source.text.length
    const sourceChanges = mappedChanges.flatMap((mapped) => {
      if (mapped.from < sourceFrom || mapped.to > sourceTo) return []
      return [
        {
          from: mapped.from - sourceFrom,
          to: mapped.to - sourceFrom,
          insert: mapped.insert,
        },
      ]
    })
    mappedHistory.source = {
      ...mappedHistory.source,
      text: applyChangesToString(mappedHistory.source.text, sourceChanges),
    }
  }

  mappedHistory.insertedSelection =
    applyChangesToString(oldContent, insideChanges) +
    history.insertedSelection.slice(movedLength)

  const mappedMove = {
    from: change.mapPos(move.from, -1),
    to: change.mapPos(move.to, 1),
    seam: change.mapPos(move.seam, 1),
  }
  if (
    mappedMove.from < 0 ||
    mappedMove.to <= mappedMove.from ||
    mappedMove.seam < 0 ||
    mappedMove.seam > change.newLength
  ) {
    return err(
      new InvalidBlockMoveError(
        'The move history no longer matches the document',
      ),
    )
  }

  const source = history.source
  const sourceText = source?.text
  let sourceReplacementIndex: number | undefined
  const inverseChanges: { from: number; to: number; insert: string }[] = []
  history.inverse.iterChanges((fromA, toA, fromB, toB, inserted) => {
    let text = inserted.toString()
    if (
      sourceReplacementIndex === undefined &&
      sourceText !== undefined &&
      mappedHistory.source !== undefined &&
      fromB <= sourceInsertion.from &&
      sourceInsertion.from + sourceText.length <= toB
    ) {
      const offset = sourceInsertion.from - fromB
      if (text.slice(offset, offset + sourceText.length) === sourceText) {
        text =
          text.slice(0, offset) +
          mappedHistory.source.text +
          text.slice(offset + sourceText.length)
        sourceReplacementIndex = inverseChanges.length
      }
    }
    inverseChanges.push({
      from: change.mapPos(fromA, fromA === toA ? 1 : -1),
      to: change.mapPos(toA, 1),
      insert: text,
    })
  })
  if (sourceReplacementIndex === undefined) {
    return err(new InvalidBlockMoveError('The move source cannot be mapped'))
  }

  mappedHistory.inverse = ChangeSet.of(inverseChanges, change.newLength)
  if (
    mappedHistory.inverse.newLength !== changeBeforeMove.newLength ||
    mappedHistory.inverse.length !== change.newLength
  ) {
    return err(
      new InvalidBlockMoveError(
        'The move history no longer matches the document',
      ),
    )
  }
  return ok({
    ...mappedMove,
    history: mappedHistory,
    changeBeforeMove,
  })
}
