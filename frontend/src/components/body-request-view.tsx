import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@fohte/ui/popover'
import { useRef } from 'react'

export type BodyRequestPhase = 'input' | 'loading' | 'error'

type BodyRequestViewProps = {
  anchor: HTMLElement | null
  open: boolean
  touchDevice: boolean
  phase: BodyRequestPhase
  instruction: string
  error?: string | undefined
  onOpenChange: (open: boolean) => void
  onInstructionChange: (instruction: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export function BodyRequestView({
  anchor,
  open,
  touchDevice,
  phase,
  instruction,
  error,
  onOpenChange,
  onInstructionChange,
  onSubmit,
  onCancel,
}: BodyRequestViewProps) {
  const isLoading = phase === 'loading'
  const anchorRef = useRef<HTMLElement | null>(null)
  anchorRef.current = anchor

  return (
    <Popover anchor={anchorRef} onOpenChange={onOpenChange} open={open}>
      {touchDevice ? (
        <PopoverTrigger
          aria-label="本文を依頼"
          className="absolute bottom-4 right-4 z-10"
          type="button"
        >
          依頼
        </PopoverTrigger>
      ) : null}
      <PopoverContent className="flex w-80 flex-col gap-3">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <label className="text-sm font-medium" htmlFor="body-request">
            本文への依頼
          </label>
          <Input
            autoFocus
            disabled={isLoading}
            id="body-request"
            onChange={(event) => {
              onInstructionChange(event.currentTarget.value)
            }}
            placeholder="ここを短く、この段落の続きを書いて"
            value={instruction}
          />
          {phase === 'error' && error !== undefined && error.length > 0 ? (
            <p role="alert">{error}</p>
          ) : null}
          {isLoading ? (
            <p aria-live="polite" role="status">
              作成中
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {isLoading ? (
              <Button onClick={onCancel} type="button" variant="outline">
                中止
              </Button>
            ) : (
              <Button disabled={instruction.trim().length === 0} type="submit">
                送信
              </Button>
            )}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
