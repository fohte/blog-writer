import type { ChangeSet } from '@codemirror/state'
import { err, ok, type Result } from 'neverthrow'

export interface TextSuggestion<Metadata = unknown> {
  id: string
  from: number
  to: number
  replacement: string
  metadata?: Metadata
  note?: string
}

export interface SuggestionPosition {
  from: number
  to: number
}

export interface TrackedSuggestionRange {
  current(): SuggestionPosition | undefined
  dispose(): void
}

export type SuggestionDecision = 'accept' | 'reject'

export type SuggestionLayerError =
  | { type: 'invalid-range'; id: string }
  | { type: 'overlapping-ranges' }
  | { type: 'not-mounted' }

export interface SuggestionLayerState<Metadata = unknown> {
  suggestions: readonly TextSuggestion<Metadata>[]
  inFlight: SuggestionPosition | null
  focusedId: string | null
}

function changedRangeTouchesSuggestion(
  from: number,
  to: number,
  changedFrom: number,
  changedTo: number,
): boolean {
  if (changedFrom === changedTo) {
    return from === to
      ? changedFrom === from
      : changedFrom > from && changedFrom < to
  }
  if (from === to) {
    return changedFrom === changedTo
      ? changedFrom === from
      : changedFrom < from && changedTo > from
  }
  return changedFrom < to && changedTo > from
}

export function mapRange(
  range: SuggestionPosition,
  changes: ChangeSet,
  changedRanges: readonly [number, number][],
): SuggestionPosition | null {
  if (
    changedRanges.some(([from, to]) =>
      changedRangeTouchesSuggestion(range.from, range.to, from, to),
    )
  ) {
    return null
  }
  return {
    from: changes.mapPos(range.from, 1),
    to: changes.mapPos(range.to, -1),
  }
}

export function isRangeValid(
  from: number,
  to: number,
  docLength: number,
): boolean {
  return (
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from >= 0 &&
    to >= from &&
    to <= docLength
  )
}

function orderSuggestions<Metadata>(
  suggestions: readonly TextSuggestion<Metadata>[],
): TextSuggestion<Metadata>[] {
  return [...suggestions].sort((a, b) => a.from - b.from || a.to - b.to)
}

export function rangesOverlap(
  first: SuggestionPosition,
  second: SuggestionPosition,
): boolean {
  if (first.from === first.to) {
    return second.from === second.to
      ? first.from === second.from
      : first.from >= second.from && first.from < second.to
  }
  if (second.from === second.to) {
    return second.from >= first.from && second.from < first.to
  }
  return first.from < second.to && second.from < first.to
}

export function hasOverlappingRange(
  suggestions: readonly SuggestionPosition[],
  position: SuggestionPosition | null | undefined,
): boolean {
  return (
    position != null &&
    suggestions.some((range) => rangesOverlap(range, position))
  )
}

export function validateSuggestions<Metadata = unknown>(
  suggestions: readonly TextSuggestion<Metadata>[],
  docLength: number,
): Result<TextSuggestion<Metadata>[], SuggestionLayerError> {
  const ids = new Set<string>()
  for (const suggestion of suggestions) {
    if (
      !isRangeValid(suggestion.from, suggestion.to, docLength) ||
      ids.has(suggestion.id)
    ) {
      return err({ type: 'invalid-range', id: suggestion.id })
    }
    ids.add(suggestion.id)
  }

  const ordered = orderSuggestions(suggestions)
  for (const [index, current] of ordered.slice(1).entries()) {
    const previous = ordered[index]
    if (previous && rangesOverlap(previous, current)) {
      return err({ type: 'overlapping-ranges' })
    }
  }
  return ok(ordered)
}

export function focusForSelection<Metadata = unknown>(
  suggestions: readonly TextSuggestion<Metadata>[],
  head: number,
): string | null {
  return (
    suggestions.find(
      (suggestion) => head >= suggestion.from && head <= suggestion.to,
    )?.id ?? null
  )
}
