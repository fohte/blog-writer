import { Button } from '@fohte/ui/button'

export type MoveConflictNoticeProps = {
  text: string
  onMove?: () => void
  onKeep?: () => void
}

export function MoveConflictNotice({
  text,
  onMove,
  onKeep,
}: MoveConflictNoticeProps) {
  return (
    <section
      aria-label="Text remains at its previous location"
      className="my-2 flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50"
      role="status"
    >
      <p className="font-medium">
        This text was written in a section that has moved.
      </p>
      <p className="whitespace-pre-wrap rounded bg-background/70 px-2 py-1 font-mono">
        {text}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onMove} size="sm" type="button">
          Move it with the section
        </Button>
        <Button onClick={onKeep} size="sm" type="button" variant="outline">
          Keep it here
        </Button>
      </div>
    </section>
  )
}
