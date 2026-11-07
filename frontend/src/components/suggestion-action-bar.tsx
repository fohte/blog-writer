import { Button } from '@fohte/ui/button'
import { Kbd } from '@fohte/ui/kbd'

export interface SuggestionActionBarProps {
  /** `seam` is for a transition that rewrites the sentences on both sides of a seam. */
  variant?: 'band' | 'seam'
  /** `sheet` pins the actions to the bottom of the screen for touch use on phones. */
  presentation?: 'inline' | 'sheet'
  label?: string | undefined
  target?: string | undefined
  note?: string | undefined
  showsMarkupAsText?: boolean | undefined
  onAccept: () => void
  onReject: () => void
}

export function SuggestionActionBar({
  variant = 'band',
  presentation = 'inline',
  label,
  target,
  note,
  showsMarkupAsText = false,
  onAccept,
  onReject,
}: SuggestionActionBarProps) {
  if (presentation === 'sheet') {
    // A seam always rewrites the sentences around it, so like the inline seam it needs no summary.
    const summary =
      variant === 'seam'
        ? []
        : [label, target].filter(
            (part): part is string => part !== undefined && part.length > 0,
          )
    return (
      <div
        aria-label="提案の操作"
        className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2.5 border-t border-border-strong bg-card px-3.5 pt-3 pb-7 font-sans"
        role="group"
      >
        {summary.length > 0 ? (
          <span className="truncate font-mono text-xs text-muted-foreground-strong">
            {label !== undefined && label.length > 0 ? (
              <span aria-hidden="true" className="text-primary">
                &gt;{' '}
              </span>
            ) : null}
            {summary.join(' · ')}
          </span>
        ) : null}
        {note !== undefined && note.length > 0 ? (
          <span className="suggestion-diff-note truncate text-xs text-muted-foreground">
            {note}
          </span>
        ) : null}
        {showsMarkupAsText ? (
          <span className="text-xs text-muted-foreground">
            文中の HTML やリンクは採用まで文字のまま
          </span>
        ) : null}
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            className="h-12 text-base"
            onClick={onReject}
            type="button"
            variant="outline"
          >
            却下
          </Button>
          <Button
            className="h-12 text-base font-bold"
            onClick={onAccept}
            type="button"
            variant="solid"
          >
            {variant === 'seam' ? '採用 (前後 2 文)' : '採用'}
          </Button>
        </div>
      </div>
    )
  }

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
