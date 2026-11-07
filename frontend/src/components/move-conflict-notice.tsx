import { Button } from '@fohte/ui/button'

export type MoveConflictNoticeProps = {
  text: string
  status?: string
  onMove?: () => void
  onKeep?: () => void
}

export function MoveConflictNotice({
  text,
  status,
  onMove,
  onKeep,
}: MoveConflictNoticeProps) {
  return (
    <section
      aria-label="移動前の場所に残った文"
      className="my-2 flex flex-col gap-2 border border-dashed border-muted-foreground px-3 py-2.5"
      role="status"
    >
      <p className="text-sm leading-loose whitespace-pre-wrap">{text}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        この文は、移動前のセクションに書き足されたものです。
      </p>
      {status !== undefined && status.length > 0 && (
        <p className="text-xs text-destructive" role="alert">
          {status}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onMove} size="sm" type="button" variant="solid">
          移動先へ移す
        </Button>
        <Button onClick={onKeep} size="sm" type="button" variant="outline">
          その場に残す
        </Button>
      </div>
    </section>
  )
}
