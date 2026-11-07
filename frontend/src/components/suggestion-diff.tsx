import type { Change } from '@codemirror/merge'
import { presentableDiff } from '@codemirror/merge'
import { Button } from '@fohte/ui/button'
import type { ReactNode } from 'react'

export interface SuggestionDiffProps {
  original: string
  replacement: string
  focused?: boolean
  inline?: boolean
  generating?: boolean
  note?: string
  onAccept?: () => void
  onReject?: () => void
}

function renderChanges(
  original: string,
  replacement: string,
  changes: readonly Change[],
) {
  if (changes.length === 0) return replacement

  const parts: ReactNode[] = []
  let originalPosition = 0

  changes.forEach((change, index) => {
    if (change.fromA > originalPosition) {
      parts.push(original.slice(originalPosition, change.fromA))
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
          {replacement.slice(change.fromB, change.toB)}
        </ins>,
      )
    }
    originalPosition = change.toA
  })

  if (originalPosition < original.length) {
    parts.push(original.slice(originalPosition))
  }
  return parts
}

export function SuggestionDiff({
  original,
  replacement,
  focused = false,
  inline = false,
  generating = false,
  note,
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
