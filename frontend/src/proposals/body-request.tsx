import { type Extension, Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'
import { errAsync, type ResultAsync } from 'neverthrow'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type * as Y from 'yjs'

import { getPremise } from '#article/premise'
import {
  type BodyRequestPhase,
  type BodyRequestPresetOption,
  BodyRequestView,
} from '#components/body-request-view'
import { loadLlmSettings } from '#lib/llm-settings'
import type { MoveHistory } from '#outline/move-history'
import {
  type BodyRequestInput,
  requestBodyProposal,
} from '#proposals/body-request-api'
import { getBodyRequestContext } from '#proposals/body-request-context'
import {
  getBodyRequestManager,
  preserveBlankLineSeparators,
} from '#proposals/body-request-manager'
import type { WriteFromKeyPointsProposal } from '#proposals/write-from-key-points'

const overlappingSuggestionError = 'この範囲には別の提案が表示されています'

export type BodyRequestEditorContext = {
  doc: Y.Doc
  history: MoveHistory
}

export type BodyRequestAccessoryContext = BodyRequestEditorContext & {
  view: EditorView | null
  presets?: readonly BodyRequestPreset[]
}

export interface BodyRequestPresetSelection {
  context: ReturnType<typeof getBodyRequestContext>
  instruction: string
  view: EditorView
}

interface BodyRequestProposalPreset extends BodyRequestPresetOption {
  createProposal: (
    selection: BodyRequestPresetSelection,
    signal: AbortSignal,
  ) => ResultAsync<WriteFromKeyPointsProposal, Error>
}

export type BodyRequestPreset =
  | (BodyRequestPresetOption & {
      onSelect: (selection: BodyRequestPresetSelection) => void
    })
  | BodyRequestProposalPreset

function cursorLineAnchor(view: EditorView | null): HTMLElement | null {
  if (!view) return null
  const position = view.state.selection.main.head
  const { node } = view.domAtPos(position)
  const positionElement = node instanceof Element ? node : node.parentElement
  const matchingWidget = Array.from(
    view.dom.querySelectorAll<HTMLElement>('.cm-suggestion-widget'),
  ).find((widget) => {
    const from = Number(widget.dataset['suggestionFrom'])
    const to = Number(widget.dataset['suggestionTo'])
    return (
      Number.isInteger(from) &&
      Number.isInteger(to) &&
      from <= position &&
      position <= to
    )
  })
  if (matchingWidget) return matchingWidget

  const line = positionElement?.closest('.cm-line')
  return line instanceof HTMLElement ? line : view.dom
}

export function bodyRequestExtensions(
  context: BodyRequestEditorContext,
): Extension[] {
  const manager = getBodyRequestManager(context.doc)
  return [
    manager.layer.extension,
    Prec.high(
      keymap.of([
        {
          key: 'Mod-k',
          run: () => {
            manager.openRequest()
            return true
          },
        },
      ]),
    ),
  ]
}

export function BodyRequestAccessory({
  doc,
  view,
  presets,
}: BodyRequestAccessoryContext) {
  const manager = useMemo(() => getBodyRequestManager(doc), [doc])
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<BodyRequestPhase>('input')
  const [requestActive, setRequestActive] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [error, setError] = useState<string>()
  const [touchDevice, setTouchDevice] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(hover: none) and (pointer: coarse)')
    const update = () => {
      setTouchDevice(media.matches)
    }
    update()
    media.addEventListener('change', update)
    return () => {
      media.removeEventListener('change', update)
    }
  }, [])

  useEffect(
    () =>
      manager.subscribe((preserveInput) => {
        setRequestActive(false)
        if (preserveInput) return
        setOpen(false)
        setError(undefined)
        setInstruction('')
        setPhase('input')
      }),
    [manager],
  )

  useEffect(
    () =>
      manager.subscribeOpen(() => {
        setError(undefined)
        setInstruction('')
        setPhase('input')
        setOpen(true)
      }),
    [manager],
  )

  useEffect(
    () => () => {
      manager.abortActiveRequest()
      manager.clearInFlight()
    },
    [manager],
  )

  const readRequestTarget = () => {
    if (!view) {
      setError('本文エディターを準備できませんでした。')
      setPhase('error')
      setOpen(true)
      return undefined
    }
    const selection = view.state.selection.main
    return {
      context: getBodyRequestContext(view.state.doc.toString(), {
        from: selection.from,
        to: selection.to,
      }),
      view,
    }
  }

  const startRequest = () => {
    const requestTarget = readRequestTarget()
    if (!requestTarget) return
    const { context, view } = requestTarget
    const premise = getPremise(doc)
    const body: BodyRequestInput = {
      instruction,
      premise: {
        audience: premise.audience ?? '',
        purpose: premise.purpose ?? '',
        claim: premise.claim ?? '',
      },
      headings: context.headings,
      section: context.section,
      target: context.target,
    }
    if (manager.layer.overlapsOtherLayer(context.range)) {
      setError(overlappingSuggestionError)
      setPhase('error')
      setOpen(true)
      return
    }
    const controller = manager.beginRequest()
    manager.clearSuggestions()
    manager.clearInFlight()
    const pending = manager.layer.setInFlight(context.range)
    if (pending.isErr()) {
      manager.finishRequest(controller)
      controller.abort()
      manager.clearInFlight()
      setError(
        pending.error.type === 'not-mounted'
          ? '本文エディターを準備できませんでした。'
          : pending.error.type === 'invalid-range'
            ? '依頼する範囲を特定できませんでした。'
            : overlappingSuggestionError,
      )
      setPhase('error')
      setOpen(true)
      return
    }

    setOpen(false)
    setError(undefined)
    setPhase('input')
    setRequestActive(true)
    view.focus()

    const result = loadLlmSettings(() => window.localStorage).match(
      (settings) =>
        requestBodyProposal(fetch, settings, body, controller.signal),
      (cause) => errAsync(cause),
    )
    void result.match(
      (response) => {
        if (controller.signal.aborted) return
        manager.finishRequest(controller)
        setRequestActive(false)
        manager.layer
          .resolveInFlight((range) =>
            preserveBlankLineSeparators(
              view.state.doc.toString(),
              range,
              response.replacement,
            ),
          )
          .match(
            () => undefined,
            () => {
              manager.clearInFlight()
              setError('提案を本文に表示できませんでした。')
              setPhase('error')
              setOpen(true)
            },
          )
      },
      (cause) => {
        manager.finishRequest(controller)
        if (controller.signal.aborted) return
        setRequestActive(false)
        manager.clearInFlight()
        setError(cause.message)
        setPhase('error')
        setOpen(true)
      },
    )
  }

  const startPresetRequest = (
    preset: BodyRequestProposalPreset,
    selection: BodyRequestPresetSelection,
  ) => {
    const { context, view } = selection
    if (manager.layer.overlapsOtherLayer(context.range)) {
      setError(overlappingSuggestionError)
      setPhase('error')
      setOpen(true)
      return
    }
    const controller = manager.beginRequest()
    manager.clearSuggestions()
    manager.clearInFlight()
    const pending = manager.layer.setInFlight(context.range)
    if (pending.isErr()) {
      manager.finishRequest(controller)
      controller.abort()
      manager.clearInFlight()
      setError(
        pending.error.type === 'not-mounted'
          ? '本文エディターを準備できませんでした。'
          : pending.error.type === 'invalid-range'
            ? '依頼する範囲を特定できませんでした。'
            : overlappingSuggestionError,
      )
      setPhase('error')
      setOpen(true)
      return
    }

    setOpen(false)
    setError(undefined)
    setPhase('input')
    setRequestActive(true)
    view.focus()
    void preset.createProposal(selection, controller.signal).match(
      (proposal) => {
        if (controller.signal.aborted) return
        manager.finishRequest(controller)
        setRequestActive(false)
        manager.layer
          .resolveInFlight(proposal.replacement, {
            metadata: proposal.metadata,
            replacementMarks: proposal.replacementMarks,
          })
          .match(
            () => undefined,
            () => {
              manager.clearInFlight()
              setError('提案を本文に表示できませんでした。')
              setPhase('error')
              setOpen(true)
            },
          )
      },
      (cause) => {
        manager.finishRequest(controller)
        if (controller.signal.aborted) return
        setRequestActive(false)
        manager.clearInFlight()
        setError(cause.message)
        setPhase('error')
        setOpen(true)
      },
    )
  }

  const cancelRequest = useCallback(() => {
    manager.cancelRequest()
    manager.clearInFlight()
    setRequestActive(false)
    setPhase('input')
    setOpen(false)
  }, [manager])

  useEffect(() => {
    if (!view) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && requestActive) {
        if (event.target instanceof Node && view.dom.contains(event.target)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        cancelRequest()
        manager.clearInFlight()
      }
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [cancelRequest, manager, requestActive, view])

  return (
    <BodyRequestView
      anchor={cursorLineAnchor(view)}
      error={error}
      instruction={instruction}
      onInstructionChange={setInstruction}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setError(undefined)
          setInstruction('')
          setPhase('input')
        } else if (phase === 'input') {
          setError(undefined)
        }
      }}
      onPresetSelect={(id) => {
        const preset = presets?.find((item) => item.id === id)
        if (!preset) return
        const requestTarget = readRequestTarget()
        if (!requestTarget) return
        const selectedInstruction = instruction
        const selection = {
          ...requestTarget,
          instruction: selectedInstruction,
        }
        setOpen(false)
        setError(undefined)
        setInstruction('')
        setPhase('input')
        if ('createProposal' in preset) {
          startPresetRequest(preset, selection)
        } else {
          preset.onSelect(selection)
        }
      }}
      onSubmit={startRequest}
      open={open}
      phase={phase}
      {...(presets === undefined ? {} : { presets })}
      touchDevice={touchDevice}
    />
  )
}
