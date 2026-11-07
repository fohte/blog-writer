import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@fohte/ui/popover'
import { useRef } from 'react'

export type BodyRequestPhase = 'input' | 'error'

export interface BodyRequestPresetOption {
  id: string
  label: string
}

type BodyRequestViewProps = {
  anchor: HTMLElement | null
  open: boolean
  touchDevice: boolean
  phase: BodyRequestPhase
  instruction: string
  error?: string | undefined
  presets?: readonly BodyRequestPresetOption[]
  onOpenChange: (open: boolean) => void
  onInstructionChange: (instruction: string) => void
  onSubmit: () => void
  onPresetSelect?: (id: string) => void
}

export function BodyRequestView({
  anchor,
  open,
  touchDevice,
  phase,
  instruction,
  error,
  presets,
  onOpenChange,
  onInstructionChange,
  onSubmit,
  onPresetSelect,
}: BodyRequestViewProps) {
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
          {presets && presets.length > 0 ? (
            <div
              aria-label="定型の依頼"
              className="flex flex-col gap-2"
              role="group"
            >
              <p className="text-sm font-medium">定型の依頼</p>
              {presets.map(({ id, label }) => (
                <Button
                  className="justify-start"
                  key={id}
                  onClick={() => onPresetSelect?.(id)}
                  type="button"
                  variant="outline"
                >
                  {label}
                </Button>
              ))}
            </div>
          ) : null}
          <label className="text-sm font-medium" htmlFor="body-request">
            本文への依頼
          </label>
          <Input
            autoFocus
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
          <div className="flex justify-end gap-2">
            <Button disabled={instruction.trim().length === 0} type="submit">
              送信
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
