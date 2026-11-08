import { Button } from '@fohte/ui/button'

import type { MoveConflictDestination } from '#article/move-conflict-headings'

export type MoveConflictNoticeProps = {
  text: string
  destination?: MoveConflictDestination | undefined
  status?: string
  onMove?: () => void
  onKeep?: () => void
}

function describeDestination(destination?: MoveConflictDestination): string {
  if (!destination)
    return 'この文は、移動前のセクションに書き足されたものです。'
  const place =
    destination.parent === undefined
      ? `「${destination.section}」`
      : `「${destination.parent}」の下の「${destination.section}」`
  return `この文が書かれた箇所は、${place}へ移動されています。`
}

export function MoveConflictNotice({
  text,
  destination,
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
        {describeDestination(destination)}
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
