import type { Change } from '@codemirror/merge'
import { presentableDiff } from '@codemirror/merge'
import { Button } from '@fohte/ui/button'
import type { ReactNode } from 'react'

export interface SuggestionDiffProps {
  original: string
  replacement: string
  focused?: boolean
  generating?: boolean
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
            backgroundColor:
              'color-mix(in srgb, var(--color-tint-red) 30%, transparent)',
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
            backgroundColor:
              'color-mix(in srgb, var(--color-tint-green) 30%, transparent)',
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
  generating = false,
  onAccept,
  onReject,
}: SuggestionDiffProps) {
  if (generating) {
    return (
      <div
        aria-live="polite"
        className="suggestion-diff-generating"
        role="status"
      >
        作成中
      </div>
    )
  }

  return (
    <div
      aria-label="提案差分"
      className="suggestion-diff"
      data-focused={focused}
      style={{
        borderInlineStart: focused
          ? '2px solid var(--color-tint-green)'
          : '2px solid transparent',
        paddingInlineStart: '0.5rem',
      }}
    >
      <div className="suggestion-diff-text" style={{ whiteSpace: 'pre-wrap' }}>
        {renderChanges(
          original,
          replacement,
          presentableDiff(original, replacement),
        )}
      </div>
      {focused && (onAccept || onReject) ? (
        <div className="suggestion-diff-actions">
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
        </div>
      ) : null}
    </div>
  )
}
