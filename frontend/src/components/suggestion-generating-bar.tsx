import { Button } from '@fohte/ui/button'
import { Kbd } from '@fohte/ui/kbd'

export interface SuggestionGeneratingBarProps {
  label?: string | undefined
  elapsedSeconds: number
  onCancel?: (() => void) | undefined
}

export function SuggestionGeneratingBar({
  label,
  elapsedSeconds,
  onCancel,
}: SuggestionGeneratingBarProps) {
  return (
    <div className="my-1 flex items-center gap-2.5 border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
      {label !== undefined && label.length > 0 ? (
        <span className="suggestion-generating-label truncate">
          <span aria-hidden="true" className="text-primary">
            &gt;
          </span>{' '}
          {label}
        </span>
      ) : null}
      {/* The elapsed seconds stay outside the live region so screen readers do not announce every tick. */}
      <span className="shrink-0">
        <span
          aria-live="polite"
          className="suggestion-diff-generating"
          role="status"
        >
          作成中
        </span>
        <span aria-hidden="true"> ··· {elapsedSeconds}s</span>
      </span>
      <span className="flex-1" />
      {onCancel ? (
        <Button
          className="shrink-0 font-sans"
          onClick={onCancel}
          size="xs"
          type="button"
          variant="outline"
        >
          中止 <Kbd>Esc</Kbd>
        </Button>
      ) : null}
    </div>
  )
}
