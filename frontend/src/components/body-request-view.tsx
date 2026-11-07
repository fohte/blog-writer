import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { List, ListItem } from '@fohte/ui/list'
import { Popover, PopoverContent, PopoverTrigger } from '@fohte/ui/popover'
import { type KeyboardEvent, useRef, useState } from 'react'

export type BodyRequestPhase = 'input' | 'error'

export type BodyRequestTarget = 'selection' | 'paragraph' | 'insertion'

export interface BodyRequestPresetOption {
  id: string
  label: string
}

export interface BodyRequestCandidate extends BodyRequestPresetOption {
  group: 'edit' | 'research'
}

export interface BodyRequestFailure {
  title: string
  reason: string
}

type BodyRequestViewProps = {
  anchor: HTMLElement | null
  open: boolean
  touchDevice: boolean
  phase: BodyRequestPhase
  instruction: string
  target: BodyRequestTarget
  failure?: BodyRequestFailure | undefined
  candidates?: readonly BodyRequestCandidate[]
  defaultHighlightedId?: string
  onOpenChange: (open: boolean) => void
  onInstructionChange: (instruction: string) => void
  onSubmit: () => void
  onCandidateSelect?: (id: string) => void
  onRetry?: () => void
}

const targetLabels: Record<BodyRequestTarget, string> = {
  selection: '選択範囲',
  paragraph: '段落',
  insertion: '挿入',
}

const targetPlaceholders: Record<BodyRequestTarget, string> = {
  selection: '選択した範囲への依頼',
  paragraph: 'この段落への依頼',
  insertion: 'ここに書く文への依頼',
}

function RequestForm({
  instruction,
  target,
  candidates,
  defaultHighlightedId,
  onInstructionChange,
  onSubmit,
  onCandidateSelect,
}: Pick<
  BodyRequestViewProps,
  | 'instruction'
  | 'target'
  | 'defaultHighlightedId'
  | 'onInstructionChange'
  | 'onSubmit'
  | 'onCandidateSelect'
> & { candidates: readonly BodyRequestCandidate[] }) {
  const [highlightedId, setHighlightedId] = useState(defaultHighlightedId)
  const editCandidates = candidates.filter(({ group }) => group === 'edit')
  const researchCandidates = candidates.filter(
    ({ group }) => group === 'research',
  )
  const ordered = [...editCandidates, ...researchCandidates]

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || ordered.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const index = ordered.findIndex(({ id }) => id === highlightedId)
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next =
        index === -1
          ? step === 1
            ? 0
            : ordered.length - 1
          : (index + step + ordered.length) % ordered.length
      setHighlightedId(ordered[next]?.id)
      return
    }
    if (event.key === 'Enter' && highlightedId !== undefined) {
      event.preventDefault()
      onCandidateSelect?.(highlightedId)
    }
  }

  const renderCandidate = ({ id, label }: BodyRequestCandidate) => (
    <ListItem
      highlighted={id === highlightedId}
      key={id}
      onSelect={() => onCandidateSelect?.(id)}
    >
      {label}
    </ListItem>
  )

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (instruction.trim().length > 0) onSubmit()
      }}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span aria-hidden="true" className="font-mono font-bold text-primary">
          &gt;
        </span>
        <label className="sr-only" htmlFor="body-request">
          本文への依頼
        </label>
        <Input
          autoFocus
          className="mx-0 h-7 w-auto flex-1 text-sm"
          id="body-request"
          onChange={(event) => {
            setHighlightedId(undefined)
            onInstructionChange(event.currentTarget.value)
          }}
          onKeyDown={handleKeyDown}
          placeholder={targetPlaceholders[target]}
          value={instruction}
          variant="ghost"
        />
        <span className="shrink-0 font-mono text-2xs text-muted-foreground">
          {targetLabels[target]}
        </span>
      </div>
      {ordered.length > 0 ? (
        <div
          aria-label="定型の依頼"
          className="border-t border-border py-1"
          role="group"
        >
          <List>{editCandidates.map(renderCandidate)}</List>
          {researchCandidates.length > 0 ? (
            <div className="mt-1 border-t border-border pt-1">
              <p className="px-3 py-1 text-2xs text-muted-foreground">調査</p>
              <List>{researchCandidates.map(renderCandidate)}</List>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}

function FailureNotice({
  failure,
  onRetry,
  onClose,
}: {
  failure: BodyRequestFailure
  onRetry?: (() => void) | undefined
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-sm">
      <p className="flex gap-1.5">
        <span aria-hidden="true" className="font-mono text-primary">
          !
        </span>
        <span role="alert">
          {failure.title} · {failure.reason}
        </span>
      </p>
      <div className="flex gap-2">
        {onRetry ? (
          <Button onClick={onRetry} size="xs" type="button" variant="outline">
            依頼し直す
          </Button>
        ) : null}
        <Button
          className="text-muted-foreground"
          onClick={onClose}
          size="xs"
          type="button"
          variant="outline"
        >
          閉じる
        </Button>
      </div>
    </div>
  )
}

export function BodyRequestView({
  anchor,
  open,
  touchDevice,
  phase,
  instruction,
  target,
  failure,
  candidates = [],
  defaultHighlightedId,
  onOpenChange,
  onInstructionChange,
  onSubmit,
  onCandidateSelect,
  onRetry,
}: BodyRequestViewProps) {
  const anchorRef = useRef<HTMLElement | null>(null)
  anchorRef.current = anchor

  return (
    <Popover anchor={anchorRef} onOpenChange={onOpenChange} open={open}>
      {touchDevice ? (
        <PopoverTrigger
          aria-label="本文を依頼"
          // Narrow screens open the request from the editor toolbar instead.
          className="absolute right-4 bottom-4 z-10 max-md:hidden"
          type="button"
        >
          依頼
        </PopoverTrigger>
      ) : null}
      <PopoverContent
        className="w-96 border-muted-foreground font-sans"
        padding="none"
      >
        {phase === 'error' && failure ? (
          <FailureNotice
            failure={failure}
            onClose={() => {
              onOpenChange(false)
            }}
            onRetry={onRetry}
          />
        ) : (
          <RequestForm
            candidates={candidates}
            instruction={instruction}
            onInstructionChange={onInstructionChange}
            onSubmit={onSubmit}
            target={target}
            {...(defaultHighlightedId === undefined
              ? {}
              : { defaultHighlightedId })}
            {...(onCandidateSelect === undefined ? {} : { onCandidateSelect })}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
