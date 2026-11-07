import type { ChangeSet } from '@codemirror/state'

import type {
  SuggestionPosition,
  TrackedSuggestionRange,
} from '#editor/suggestion-layer-range'

export class SuggestionRangeTracker {
  private nextId = 0
  private readonly ranges = new Map<string, SuggestionPosition>()

  track(position: SuggestionPosition): TrackedSuggestionRange {
    const id = `accepted-${String(this.nextId)}`
    this.nextId += 1
    this.ranges.set(id, position)
    return {
      current: () => this.ranges.get(id),
      dispose: () => {
        this.ranges.delete(id)
      },
    }
  }

  map(changes: ChangeSet): void {
    for (const [id, range] of this.ranges) {
      if (range.from === range.to) {
        const position = changes.mapPos(range.from, 1)
        this.ranges.set(id, { from: position, to: position })
        continue
      }

      let coveredRange: SuggestionPosition | undefined
      changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        if (fromA <= range.from && toA >= range.to) {
          coveredRange = { from: fromB, to: toB }
        }
      })
      if (coveredRange) {
        this.ranges.set(id, coveredRange)
        continue
      }

      const from = changes.mapPos(range.from, 1)
      const to = changes.mapPos(range.to, -1)
      this.ranges.set(id, {
        from: Math.min(from, to),
        to: Math.max(from, to),
      })
    }
  }

  clear(): void {
    this.ranges.clear()
  }
}
