import { type Extension, Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'
import { errAsync, type ResultAsync } from 'neverthrow'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type * as Y from 'yjs'

import { listEvidenceOverlapping, listSources } from '#article/index'
import { getPremise } from '#article/premise'
import {
  type BodyRequestCandidate,
  type BodyRequestFailure,
  type BodyRequestPhase,
  type BodyRequestPresetOption,
  type BodyRequestTarget,
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

const editCandidates: readonly BodyRequestCandidate[] = [
  { id: 'concise', label: '簡潔にする', group: 'edit' },
  { id: 'add-example', label: '例を 1 つ足す', group: 'edit' },
  { id: 'smooth-flow', label: '前後とのつながりを直す', group: 'edit' },
]

type BodyRequestProposalResult = Pick<
  WriteFromKeyPointsProposal,
  'replacement'
> &
  Partial<Pick<WriteFromKeyPointsProposal, 'metadata' | 'replacementMarks'>>

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

function readSelectionContext(view: EditorView) {
  const selection = view.state.selection.main
  return getBodyRequestContext(view.state.doc.toString(), {
    from: selection.from,
    to: selection.to,
  })
}

function readTarget(view: EditorView | null): BodyRequestTarget {
  if (!view) return 'paragraph'
  if (!view.state.selection.main.empty) return 'selection'
  const { range } = readSelectionContext(view)
  return range.from === range.to ? 'insertion' : 'paragraph'
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
  const [failure, setFailure] = useState<BodyRequestFailure>()
  const [touchDevice, setTouchDevice] = useState(false)
  // The editor keeps its selection while the request input has focus, so typing does not change the target.
  const target = useMemo(
    () => (open ? readTarget(view) : 'paragraph'),
    [open, view],
  )

  const fail = useCallback((reason: string, title = '作成できませんでした') => {
    setFailure({ title, reason })
    setPhase('error')
    setOpen(true)
  }, [])

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
        setFailure(undefined)
        setInstruction('')
        setPhase('input')
      }),
    [manager],
  )

  useEffect(
    () =>
      manager.subscribeOpen(() => {
        setFailure(undefined)
        setInstruction('')
        setPhase('input')
        setOpen(true)
      }),
    [manager],
  )

  useEffect(
    () =>
      manager.subscribeEvidenceError(() => {
        fail('提案は本文に採用されています。', '根拠を保存できませんでした')
      }),
    [fail, manager],
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
      fail('本文エディターを準備できませんでした。')
      return undefined
    }
    return { context: readSelectionContext(view), view }
  }

  const startRequest = (requestInstruction: string) => {
    const requestTarget = readRequestTarget()
    if (!requestTarget) return
    const { context } = requestTarget
    const premise = getPremise(doc)
    const body: BodyRequestInput = {
      instruction: requestInstruction,
      premise: {
        audience: premise.audience ?? '',
        purpose: premise.purpose ?? '',
        claim: premise.claim ?? '',
      },
      headings: context.headings,
      section: context.section,
      target: context.target,
    }
    const sources = listSources(doc).map(
      ({ checkedAt, summary, title, url }) => ({
        title,
        url,
        summary,
        checked_at: checkedAt,
      }),
    )
    const evidenceQuotes = listEvidenceOverlapping(doc, context.range)
      .map(({ quote }) => quote)
      .filter((quote) => quote.trim().length > 0)
    if (sources.length > 0) body.sources = sources
    if (evidenceQuotes.length > 0) body.evidence_quotes = evidenceQuotes
    const selection: BodyRequestPresetSelection = {
      ...requestTarget,
      instruction: requestInstruction,
    }
    startProposalRequest(
      selection,
      requestInstruction,
      (signal) =>
        loadLlmSettings(() => window.localStorage).match(
          (settings) => requestBodyProposal(fetch, settings, body, signal),
          (cause) => errAsync(cause),
        ),
      (proposal, range) =>
        preserveBlankLineSeparators(
          selection.view.state.doc.toString(),
          range,
          proposal.replacement,
        ),
    )
  }

  const startProposalRequest = (
    requestTarget: BodyRequestPresetSelection,
    label: string,
    createProposal: (
      signal: AbortSignal,
    ) => ResultAsync<BodyRequestProposalResult, Error>,
    resolveReplacement: (
      proposal: BodyRequestProposalResult,
      range: { from: number; to: number },
    ) => string = ({ replacement }) => replacement,
  ) => {
    const { context, view } = requestTarget
    if (manager.layer.overlapsOtherLayer(context.range)) {
      fail(overlappingSuggestionError)
      return
    }
    const controller = manager.beginRequest()
    manager.clearSuggestions()
    manager.clearInFlight()
    const pending = manager.layer.setInFlight({ ...context.range, label })
    if (pending.isErr()) {
      manager.finishRequest(controller)
      controller.abort()
      manager.clearInFlight()
      fail(
        pending.error.type === 'not-mounted'
          ? '本文エディターを準備できませんでした。'
          : pending.error.type === 'invalid-range'
            ? '依頼する範囲を特定できませんでした。'
            : overlappingSuggestionError,
      )
      return
    }

    setOpen(false)
    setFailure(undefined)
    setPhase('input')
    setRequestActive(true)
    view.focus()
    void createProposal(controller.signal).match(
      (response) => {
        if (controller.signal.aborted) return
        manager.finishRequest(controller)
        setRequestActive(false)
        manager.layer
          .resolveInFlight((range) => resolveReplacement(response, range), {
            ...(response.metadata === undefined
              ? {}
              : { metadata: response.metadata }),
            ...(response.replacementMarks === undefined
              ? {}
              : { replacementMarks: response.replacementMarks }),
          })
          .match(
            () => undefined,
            () => {
              manager.clearInFlight()
              fail('提案を本文に表示できませんでした。')
            },
          )
      },
      (cause) => {
        manager.finishRequest(controller)
        if (controller.signal.aborted) return
        setRequestActive(false)
        manager.clearInFlight()
        fail(cause.message)
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

  const selectPreset = (preset: BodyRequestPreset) => {
    const requestTarget = readRequestTarget()
    if (!requestTarget) return
    const selection = { ...requestTarget, instruction }
    setOpen(false)
    setFailure(undefined)
    setInstruction('')
    setPhase('input')
    if ('createProposal' in preset) {
      startProposalRequest(selection, preset.label, (signal) =>
        preset.createProposal(selection, signal),
      )
    } else {
      preset.onSelect(selection)
    }
  }

  return (
    <BodyRequestView
      anchor={cursorLineAnchor(view)}
      candidates={[
        ...editCandidates,
        ...(presets ?? []).map(({ id, label }): BodyRequestCandidate => ({
          id,
          label,
          group: 'research',
        })),
      ]}
      failure={failure}
      instruction={instruction}
      onCandidateSelect={(id) => {
        const editCandidate = editCandidates.find((item) => item.id === id)
        if (editCandidate) {
          startRequest(editCandidate.label)
          return
        }
        const preset = presets?.find((item) => item.id === id)
        if (preset) selectPreset(preset)
      }}
      onInstructionChange={setInstruction}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setFailure(undefined)
          setInstruction('')
          setPhase('input')
        } else if (phase === 'input') {
          setFailure(undefined)
        }
      }}
      onRetry={() => {
        setFailure(undefined)
        setPhase('input')
      }}
      onSubmit={() => {
        startRequest(instruction)
      }}
      open={open}
      phase={phase}
      target={target}
      touchDevice={touchDevice}
    />
  )
}
