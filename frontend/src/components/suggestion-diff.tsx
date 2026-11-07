import type { Change } from '@codemirror/merge'
import { presentableDiff } from '@codemirror/merge'
import { Button } from '@fohte/ui/button'
import type { ReactNode } from 'react'

import type { SuggestionReplacementMark } from '#editor/suggestion-layer'

export interface SuggestionDiffProps {
  original: string
  replacement: string
  focused?: boolean
  inline?: boolean
  generating?: boolean
  note?: string
  replacementMarks?: readonly SuggestionReplacementMark[]
  onAccept?: () => void
  onReject?: () => void
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
          className="suggestion-diff-removed"
          key={`removed-${String(index)}`}
          style={{
            backgroundColor: 'var(--color-tint-red)',
            color: 'var(--color-tint-red-foreground)',
            textDecoration: 'line-through',
          }}
        >
          {original.slice(change.fromA, change.toA)}
        </del>,
      )
    }
    if (change.toB > change.fromB) {
      parts.push(
        <ins
          className="suggestion-diff-added"
          key={`added-${String(index)}`}
          style={{
            backgroundColor: 'var(--color-tint-green)',
            color: 'var(--color-tint-green-foreground)',
            textDecoration: 'none',
          }}
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
  focused = false,
  inline = false,
  generating = false,
  note,
  replacementMarks = [],
  onAccept,
  onReject,
}: SuggestionDiffProps) {
  const Tag = inline ? 'span' : 'div'

  if (generating) {
    return (
      <Tag
        aria-live="polite"
        className="suggestion-diff-generating"
        role="status"
      >
        作成中
      </Tag>
    )
  }

  return (
    <Tag
      aria-label="提案差分"
      className="suggestion-diff"
      data-focused={focused}
      style={{
        display: inline ? 'inline' : undefined,
        borderInlineStart: focused
          ? '3px solid var(--color-tint-green-foreground)'
          : '2px solid transparent',
        paddingInlineStart: '0.5rem',
      }}
    >
      <Tag className="suggestion-diff-text" style={{ whiteSpace: 'pre-wrap' }}>
        {renderChanges(
          original,
          replacement,
          presentableDiff(original, replacement),
          replacementMarks,
        )}
      </Tag>
      {note !== undefined && note.length > 0 ? (
        <Tag
          className="suggestion-diff-note text-sm text-muted-foreground"
          style={{ marginInlineStart: inline ? '0.5rem' : undefined }}
        >
          {note}
        </Tag>
      ) : null}
      {focused && (onAccept || onReject) ? (
        <Tag className="suggestion-diff-actions">
          {onAccept ? (
            <Button onClick={onAccept} size="sm" type="button">
              ✓ 採用
            </Button>
          ) : null}
          {onReject ? (
            <Button
              onClick={onReject}
              size="sm"
              type="button"
              variant="outline"
            >
              × 却下
            </Button>
          ) : null}
        </Tag>
      ) : null}
    </Tag>
  )
}
