import { Button } from '@fohte/ui/button'
import { Kbd } from '@fohte/ui/kbd'

export interface SuggestionActionBarProps {
  /** `seam` is for a transition that rewrites the sentences on both sides of a seam. */
  variant?: 'band' | 'seam'
  label?: string | undefined
  target?: string | undefined
  note?: string | undefined
  showsMarkupAsText?: boolean | undefined
  onAccept: () => void
  onReject: () => void
}

export function SuggestionActionBar({
  variant = 'band',
  label,
  target,
  note,
  showsMarkupAsText = false,
  onAccept,
  onReject,
}: SuggestionActionBarProps) {
  if (variant === 'seam') {
    return (
      <div
        aria-label="提案の操作"
        className="mt-4 flex justify-end gap-2"
        role="group"
      >
        <Button
          className="font-sans"
          onClick={onReject}
          size="sm"
          type="button"
          variant="outline"
        >
          却下
        </Button>
        <Button
          className="font-sans"
          onClick={onAccept}
          size="sm"
          type="button"
          variant="solid"
        >
          採用 (前後 2 文)
        </Button>
      </div>
    )
  }

  return (
    <div
      aria-label="提案の操作"
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border border-border bg-card px-2.5 py-2 text-xs text-muted-foreground"
      role="group"
    >
      {label !== undefined && label.length > 0 ? (
        <span className="font-mono">
          <span aria-hidden="true" className="text-primary">
            &gt;
          </span>{' '}
          {label}
        </span>
      ) : null}
      {target !== undefined ? <span>{target}</span> : null}
      {note !== undefined && note.length > 0 ? (
        <span className="suggestion-diff-note">{note}</span>
      ) : null}
      {showsMarkupAsText ? (
        <span>文中の HTML やリンクは採用まで文字のまま</span>
      ) : null}
      <span className="flex-1" />
      <Button
        className="font-sans"
        onClick={onReject}
        size="sm"
        type="button"
        variant="outline"
      >
        却下 <Kbd>Esc</Kbd>
      </Button>
      <Button
        className="font-sans"
        onClick={onAccept}
        size="sm"
        type="button"
        variant="solid"
      >
        採用 <Kbd>Tab</Kbd>
      </Button>
    </div>
  )
}
