import { Button } from '@fohte/ui/button'

export type OutlineHeadingActionsProps = {
  onOutdent?: (() => void) | undefined
  onIndent?: (() => void) | undefined
  onMoveUp?: (() => void) | undefined
  onMoveDown?: (() => void) | undefined
  onDelete?: (() => void) | undefined
  onUndo: () => void
}

export function OutlineHeadingActions({
  onOutdent,
  onIndent,
  onMoveUp,
  onMoveDown,
  onDelete,
  onUndo,
}: OutlineHeadingActionsProps) {
  const actions = [
    { label: '階層を上げる', text: '上げる', glyph: '⇤', onClick: onOutdent },
    { label: '階層を下げる', text: '下げる', glyph: '⇥', onClick: onIndent },
    { label: '配下ごと上へ', text: '上へ', glyph: '↑', onClick: onMoveUp },
    { label: '配下ごと下へ', text: '下へ', glyph: '↓', onClick: onMoveDown },
    { label: '見出しを消す', text: '消す', glyph: '⌫', onClick: onDelete },
    { label: '取り消す', text: '取消', glyph: '↶', onClick: onUndo },
  ]

  return (
    <div
      aria-label="見出しの操作"
      className="fixed inset-x-0 bottom-0 grid h-13 grid-cols-6 border-t border-border bg-card"
      role="toolbar"
    >
      {actions.map(({ label, text, glyph, onClick }) => (
        <Button
          aria-label={label}
          className="h-full flex-col gap-0 rounded-none px-0 font-sans text-2xs text-muted-foreground"
          disabled={onClick === undefined}
          key={label}
          onClick={() => {
            onClick?.()
          }}
          type="button"
          variant="ghost"
        >
          <span aria-hidden="true" className="text-base text-foreground">
            {glyph}
          </span>
          {text}
        </Button>
      ))}
    </div>
  )
}
