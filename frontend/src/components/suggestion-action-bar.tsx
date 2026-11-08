import { Button } from '@fohte/ui/button'
import { Kbd } from '@fohte/ui/kbd'

import { altLabel } from '#lib/key-labels'

interface SuggestionNavigation {
  current: number
  total: number
  onNext: () => void
  onPrevious: () => void
}

function joinDetails(...parts: (string | undefined)[]): string {
  return parts
    .filter((part) => part !== undefined && part.length > 0)
    .join(' · ')
}

export interface SuggestionActionBarProps {
  /** `seam` is for a transition that rewrites the sentences on both sides of a seam. */
  variant?: 'band' | 'seam'
  /** `sheet` pins the actions to the bottom of the screen for touch use on phones. */
  presentation?: 'inline' | 'sheet'
  label?: string | undefined
  target?: string | undefined
  note?: string | undefined
  showsMarkupAsText?: boolean | undefined
  /** Left out when this is the only suggestion, since there is nowhere to move. */
  navigation?: SuggestionNavigation | undefined
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
  navigation,
  onAccept,
  onReject,
}: SuggestionActionBarProps) {
  if (presentation === 'sheet') {
    // A seam always rewrites the sentences around it, so like the inline seam it needs no summary.
    const summary = variant === 'seam' ? '' : joinDetails(label, target)
    return (
      <div
        aria-label="提案の操作"
        className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2.5 border-t border-border-strong bg-card px-3.5 pt-3 pb-7 font-sans"
        role="group"
      >
        {summary.length > 0 || navigation !== undefined ? (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground-strong">
              {variant !== 'seam' && label !== undefined && label.length > 0 ? (
                <span aria-hidden="true" className="text-primary">
                  &gt;{' '}
                </span>
              ) : null}
              {summary}
            </span>
            {navigation === undefined ? null : (
              <>
                <Button
                  aria-label="前の提案"
                  className="w-11"
                  onClick={navigation.onPrevious}
                  type="button"
                  variant="outline"
                >
                  ‹
                </Button>
                <span className="font-mono text-xs text-muted-foreground-strong">
                  {navigation.current}/{navigation.total}
                </span>
                <Button
                  aria-label="次の提案"
                  className="w-11"
                  onClick={navigation.onNext}
                  type="button"
                  variant="outline"
                >
                  ›
                </Button>
              </>
            )}
          </div>
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

  const details = joinDetails(
    target,
    navigation === undefined
      ? undefined
      : `${String(navigation.current)} / ${String(navigation.total)}`,
  )

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
      {details.length > 0 ? <span>{details}</span> : null}
      {note !== undefined && note.length > 0 ? (
        <span className="suggestion-diff-note">{note}</span>
      ) : null}
      {showsMarkupAsText ? (
        <span>文中の HTML やリンクは採用まで文字のまま</span>
      ) : null}
      <span className="flex-1" />
      {navigation === undefined ? null : (
        <span>
          <Kbd>{altLabel}]</Kbd> 次の提案
        </span>
      )}
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
