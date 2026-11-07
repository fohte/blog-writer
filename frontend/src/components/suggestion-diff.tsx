import type { Change } from '@codemirror/merge'
import { presentableDiff } from '@codemirror/merge'
import type { ReactNode } from 'react'

import type { SuggestionReplacementMark } from '#editor/suggestion-layer'

export interface SuggestionDiffProps {
  original: string
  replacement: string
  inline?: boolean
  replacementMarks?: readonly SuggestionReplacementMark[]
}

function renderChanges(
  original: string,
  replacement: string,
  changes: readonly Change[],
  marks: readonly SuggestionReplacementMark[],
) {
  if (changes.length === 0) return renderMarkedText(replacement, 0, marks)

  const parts: ReactNode[] = []
  let originalPosition = 0
  let replacementPosition = 0

  changes.forEach((change, index) => {
    if (change.fromA > originalPosition) {
      const unchangedLength = change.fromA - originalPosition
      parts.push(
        renderMarkedText(
          replacement.slice(
            replacementPosition,
            replacementPosition + unchangedLength,
          ),
          replacementPosition,
          marks,
        ),
      )
      replacementPosition += unchangedLength
    }
    if (change.toA > change.fromA) {
      parts.push(
        <del
          className="suggestion-diff-removed bg-tint-red text-tint-red-foreground line-through decoration-tint-red-foreground"
          key={`removed-${String(index)}`}
        >
          {original.slice(change.fromA, change.toA)}
        </del>,
      )
    }
    if (change.toB > change.fromB) {
      parts.push(
        <ins
          className="suggestion-diff-added bg-tint-green text-tint-green-foreground underline decoration-tint-green-foreground underline-offset-4"
          key={`added-${String(index)}`}
        >
          {renderMarkedText(
            replacement.slice(change.fromB, change.toB),
            change.fromB,
            marks,
          )}
        </ins>,
      )
    }
    originalPosition = change.toA
    replacementPosition = change.toB
  })

  if (originalPosition < original.length) {
    parts.push(
      renderMarkedText(
        replacement.slice(replacementPosition),
        replacementPosition,
        marks,
      ),
    )
  }
  return parts
}

function renderMarkedText(
  text: string,
  offset: number,
  marks: readonly SuggestionReplacementMark[],
): ReactNode[] {
  if (marks.length === 0) return [text]
  const parts: ReactNode[] = []
  let position = 0
  for (const [index, mark] of marks.entries()) {
    const from = Math.max(mark.from - offset, 0)
    const to = Math.min(mark.to - offset, text.length)
    if (from >= text.length || to <= from) continue
    if (from > position) parts.push(text.slice(position, from))
    const color =
      mark.verdict === 'supported'
        ? 'var(--tint-green-foreground)'
        : 'var(--tint-yellow-foreground)'
    parts.push(
      <span
        className={`suggestion-evidence-${mark.verdict}`}
        key={`${String(offset)}-${String(index)}`}
        style={{ borderBottom: `1px dotted ${color}`, color }}
      >
        {text.slice(from, to)}
      </span>,
    )
    position = to
  }
  if (position < text.length) parts.push(text.slice(position))
  return parts
}

export function SuggestionDiff({
  original,
  replacement,
  inline = false,
  replacementMarks = [],
}: SuggestionDiffProps) {
  const Tag = inline ? 'span' : 'div'

  return (
    <Tag aria-label="提案差分" className="suggestion-diff">
      <Tag className="suggestion-diff-text whitespace-pre-wrap">
        {renderChanges(
          original,
          replacement,
          presentableDiff(original, replacement),
          replacementMarks,
        )}
      </Tag>
    </Tag>
  )
}
