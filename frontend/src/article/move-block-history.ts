import { ChangeSet, Text } from '@codemirror/state'
import { err, ok, Result } from 'neverthrow'

import { InvalidBlockMoveError } from '#article/errors'
import type { MoveBlockResult } from '#article/move-block'
import type { MoveSource } from '#article/move-block-plan'
import {
  mapWithinRange,
  planBlockMove,
  sectionReplacements,
  transformedText,
  validateMove,
} from '#article/move-block-plan'
import {
  collectHeadings,
  findMoveBlockRange,
  validatePlannedMoveStructure,
} from '#article/move-block-structure'

export type MoveSeparator = {
  side: 'prefix' | 'suffix'
  text: string
}

export type MoveRecord = {
  insertedSelection: string
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
  markdownBeforeMove: string
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

function moveContentReplacements(
  content: string,
  move: MoveBlockResult,
): { replacements: ReturnType<typeof sectionReplacements>; length: number } {
  if (move.originalHeadingLevel === undefined) {
    return { replacements: [], length: content.length }
  }

  const headings = collectHeadings(content)
  const currentHeadingLevel = headings[0]?.level
  if (currentHeadingLevel === undefined) {
    return { replacements: [], length: content.length }
  }
  const range = {
    from: 0,
    to: content.length,
    headingLevel: currentHeadingLevel,
  }
  const replacements = sectionReplacements(
    content,
    range,
    move.originalHeadingLevel,
    headings,
  )
  const transformed = transformedText(content, range, replacements)
  return { replacements, length: transformed.length }
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

function reverseMovePlan(
  markdown: string,
  move: MoveBlockResult,
  history: MoveRecord,
): Result<
  {
    plannedMove: ReturnType<typeof planBlockMove>
    range: { from: number; to: number; headingLevel?: number }
  },
  InvalidBlockMoveError
> {
  const headings = collectHeadings(markdown)
  const validation = validateMove(
    markdown,
    {
      from: move.from,
      destination: move.seam,
      ...(move.originalHeadingLevel === undefined
        ? {}
        : { headingLevel: move.originalHeadingLevel }),
    },
    headings,
  )
  if (validation.isErr()) return err(validation.error)
  const { range, targetLevel } = validation.value
  if (markdown.slice(range.from, range.to) !== history.insertedSelection) {
    return err(new InvalidBlockMoveError('The moved block has changed'))
  }

  const replacements = sectionReplacements(
    markdown,
    range,
    targetLevel,
    headings,
  )
  const movedText = transformedText(markdown, range, replacements)
  const removeRanges = history.separators.map(({ side, text }) => {
    const to = side === 'prefix' ? range.from : range.to
    return { from: to - text.length, to, text }
  })
  if (
    removeRanges.some(
      ({ from, to, text }) =>
        from < 0 ||
        to < from ||
        to > markdown.length ||
        markdown.slice(from, to) !== text,
    )
  ) {
    return err(new InvalidBlockMoveError('A moved separator has changed'))
  }

  const removeFrom = Math.min(
    range.from,
    ...removeRanges.map((separator) => separator.from),
  )
  const removeTo = Math.max(
    range.to,
    ...removeRanges.map((separator) => separator.to),
  )
  const plannedMove = planBlockMove({
    markdown,
    removeFrom,
    removeTo,
    destination: move.seam,
    movedText,
    ...(history.source === undefined ? {} : { replacement: history.source }),
  })
  const structureError = validatePlannedMoveStructure({
    originalMarkdown: markdown,
    originalRange: range,
    plannedMarkdown: plannedMove.plannedMarkdown,
    movedRange: {
      from: plannedMove.insertedFrom,
      to: plannedMove.insertedTo,
    },
    isSection: range.headingLevel !== undefined,
  })
  return structureError ? err(structureError) : ok({ plannedMove, range })
}

export function mapMoveHistoryRemote(
  markdown: string,
  move: MoveBlockResult,
  history: MoveRecord,
  change: ChangeSet,
  inverse: ChangeSet,
): Result<MappedMoveRecord, InvalidBlockMoveError> {
  if (
    inverse.length !== change.length ||
    markdown.length !== change.newLength
  ) {
    return err(
      new InvalidBlockMoveError(
        'The move history no longer matches the document',
      ),
    )
  }

  const movedLength = move.to - move.from
  const oldContent = history.insertedSelection.slice(0, movedLength)
  const contentMapping = moveContentReplacements(oldContent, move)
  const sourceInsertion = findInsertedContent(
    inverse,
    history,
    transformedText(
      oldContent,
      { from: 0, to: oldContent.length },
      contentMapping.replacements,
    ),
    oldContent.length,
  )
  if (!sourceInsertion)
    return err(new InvalidBlockMoveError('The move source cannot be mapped'))

  const mapContentPosition = (position: number): number | undefined => {
    if (position === move.from) return 0
    if (position === move.to) return contentMapping.length
    const relativeReplacements = contentMapping.replacements.map(
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

  const mappedHistory: MoveRecord = {
    ...history,
    separators: [...history.separators],
    ...(history.source === undefined ? {} : { source: { ...history.source } }),
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

  const mappedMove = {
    from: change.mapPos(move.from, -1),
    to: change.mapPos(move.to, 1),
    seam: change.mapPos(move.seam, 1),
  }
  const currentRange = findMoveBlockRange(markdown, mappedMove.from)
  if (!currentRange || currentRange.from !== mappedMove.from) {
    return err(
      new InvalidBlockMoveError('The moved block is no longer available'),
    )
  }
  mappedHistory.insertedSelection = markdown.slice(
    currentRange.from,
    currentRange.to,
  )
  const mappedMoveResult: MoveBlockResult = { ...move, ...mappedMove }
  const reversePlan = reverseMovePlan(markdown, mappedMoveResult, mappedHistory)
  if (reversePlan.isErr()) return err(reversePlan.error)
  const updatedInverse = changeSetForMove(
    markdown,
    reversePlan.value.plannedMove,
  )
  if (updatedInverse.newLength !== changeBeforeMove.newLength) {
    return err(
      new InvalidBlockMoveError(
        'The move history no longer matches the document',
      ),
    )
  }
  const markdownBeforeMove = updatedInverse
    .apply(Text.of(markdown.split('\n')))
    .toString()
  if (markdownBeforeMove.length !== changeBeforeMove.newLength) {
    return err(
      new InvalidBlockMoveError(
        'The move history no longer matches the document',
      ),
    )
  }

  mappedHistory.inverse = updatedInverse
  return ok({
    ...mappedMove,
    history: mappedHistory,
    changeBeforeMove,
    markdownBeforeMove,
  })
}
