import { type Extension, Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'
import { errAsync } from 'neverthrow'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type * as Y from 'yjs'

import { getPremise } from '#article/premise'
import {
  type BodyRequestPhase,
  BodyRequestView,
} from '#components/body-request-view'
import type { MarkdownEditorHandle } from '#components/markdown-editor'
import { createSuggestionLayer } from '#editor/suggestion-layer'
import { loadLlmSettings } from '#lib/llm-settings'
import type { MoveHistory } from '#outline/move-history'
import {
  type BodyRequestInput,
  requestBodyProposal,
} from '#proposals/body-request-api'
import { getBodyRequestContext } from '#proposals/body-request-context'

export type BodyRequestEditorContext = {
  doc: Y.Doc
  history: MoveHistory
}

export type BodyRequestAccessoryContext = BodyRequestEditorContext & {
  view: EditorView | null
  replaceBody: MarkdownEditorHandle['replaceBody']
}

function preserveBlankLineSeparators(
  text: string,
  range: { from: number; to: number },
  replacement: string,
): string {
  if (range.from !== range.to || replacement.length === 0) return replacement

  const before = text.slice(0, range.from)
  const after = text.slice(range.to)
  const needsBeforeSeparator =
    before.trim().length > 0 &&
    !before.endsWith('\n\n') &&
    !replacement.startsWith('\n')
  const needsAfterSeparator =
    after.trim().length > 0 &&
    !after.startsWith('\n\n') &&
    !replacement.endsWith('\n')

  return `${needsBeforeSeparator ? '\n' : ''}${replacement}${needsAfterSeparator ? '\n' : ''}`
}

class BodyRequestManager {
  readonly layer = createSuggestionLayer({
    onCancelInFlight: () => {
      this.cancelRequest()
    },
    onInFlightRangeEdited: () => {
      this.cancelRequest()
    },
  })

  private activeRequest: AbortController | null = null
  private readonly listeners = new Set<() => void>()
  private readonly openListeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeOpen(listener: () => void): () => void {
    this.openListeners.add(listener)
    return () => this.openListeners.delete(listener)
  }

  openRequest(): void {
    this.openListeners.forEach((listener) => {
      listener()
    })
  }

  beginRequest(): AbortController {
    this.abortActiveRequest()
    const controller = new AbortController()
    this.activeRequest = controller
    return controller
  }

  finishRequest(controller: AbortController): void {
    if (this.activeRequest === controller) this.activeRequest = null
  }

  clearInFlight(): void {
    this.layer.setInFlight(null).match(
      () => undefined,
      () => undefined,
    )
  }

  clearSuggestions(): void {
    this.layer.setSuggestions([]).match(
      () => undefined,
      () => undefined,
    )
  }

  abortActiveRequest(): void {
    this.activeRequest?.abort()
    this.activeRequest = null
  }

  cancelRequest(): void {
    this.abortActiveRequest()
    this.listeners.forEach((listener) => {
      listener()
    })
  }
}

const managers = new WeakMap<Y.Doc, BodyRequestManager>()

function getManager(doc: Y.Doc): BodyRequestManager {
  let manager = managers.get(doc)
  if (!manager) {
    manager = new BodyRequestManager()
    managers.set(doc, manager)
  }
  return manager
}

export function bodyRequestExtensions(
  context: BodyRequestEditorContext,
): Extension[] {
  const manager = getManager(context.doc)
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
}: BodyRequestAccessoryContext) {
  const manager = useMemo(() => getManager(doc), [doc])
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<BodyRequestPhase>('input')
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
      manager.subscribe(() => {
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

  const startRequest = () => {
    if (!view) return
    const selection = view.state.selection.main
    const context = getBodyRequestContext(view.state.doc.toString(), {
      from: selection.from,
      to: selection.to,
    })
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
    const controller = manager.beginRequest()
    manager.clearSuggestions()
    manager.clearInFlight()
    const pending = manager.layer.setInFlight(context.range)
    if (pending.isErr()) {
      manager.finishRequest(controller)
      controller.abort()
      manager.clearInFlight()
      setError('この範囲には別の提案が表示されています。')
      setPhase('error')
      setOpen(true)
      return
    }

    setOpen(true)
    setError(undefined)
    setPhase('loading')
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
        setPhase('input')
        manager.layer
          .resolveInFlight((range) =>
            preserveBlankLineSeparators(
              view.state.doc.toString(),
              range,
              response.replacement,
            ),
          )
          .match(
            () => {
              setOpen(false)
            },
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
    setPhase('input')
    setOpen(false)
  }, [manager])

  useEffect(() => {
    if (!view) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && phase === 'loading') {
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
  }, [cancelRequest, manager, phase, view])

  return (
    <BodyRequestView
      anchor={view?.dom ?? null}
      error={error}
      instruction={instruction}
      onCancel={cancelRequest}
      onInstructionChange={setInstruction}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen && phase === 'input') setError(undefined)
      }}
      onSubmit={startRequest}
      open={open}
      phase={phase}
      touchDevice={touchDevice}
    />
  )
}
