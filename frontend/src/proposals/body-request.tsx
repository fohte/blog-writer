import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
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

class BodyRequestManager {
  readonly layer = createSuggestionLayer({
    onCancelInFlight: () => {
      this.cancelRequest()
    },
  })

  private activeRequest: AbortController | null = null
  private readonly listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  beginRequest(): AbortController {
    this.activeRequest?.abort()
    const controller = new AbortController()
    this.activeRequest = controller
    return controller
  }

  finishRequest(controller: AbortController): void {
    if (this.activeRequest === controller) this.activeRequest = null
  }

  cancelRequest(): void {
    this.activeRequest?.abort()
    this.activeRequest = null
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
  return [manager.layer.extension]
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
    const pending = manager.layer.setInFlight(context.range)
    if (pending.isErr()) {
      manager.finishRequest(controller)
      controller.abort()
      manager.layer.setInFlight(null).match(
        () => undefined,
        () => undefined,
      )
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
        manager.layer.resolveInFlight(response.replacement).match(
          () => {
            setOpen(false)
          },
          () => {
            manager.layer.setInFlight(null).match(
              () => undefined,
              () => undefined,
            )
            setError('提案を本文に表示できませんでした。')
            setPhase('error')
            setOpen(true)
          },
        )
      },
      (cause) => {
        manager.finishRequest(controller)
        if (controller.signal.aborted) return
        manager.layer.setInFlight(null).match(
          () => undefined,
          () => undefined,
        )
        setError(cause.message)
        setPhase('error')
        setOpen(true)
      },
    )
  }

  const cancelRequest = useCallback(() => {
    manager.cancelRequest()
    manager.layer.setInFlight(null).match(
      () => undefined,
      () => undefined,
    )
    setPhase('input')
    setOpen(false)
  }, [manager])

  useEffect(() => {
    if (!view) return
    const handleOpen = () => {
      setError(undefined)
      setInstruction('')
      setPhase('input')
      setOpen(true)
    }
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && phase === 'loading') {
        event.preventDefault()
        cancelRequest()
        return
      }
      if (
        event.key.toLowerCase() === 'k' &&
        (event.metaKey || event.ctrlKey) &&
        event.target instanceof Node &&
        view.dom.contains(event.target)
      ) {
        event.preventDefault()
        handleOpen()
      }
    }
    window.addEventListener('keydown', handleShortcut, true)
    return () => {
      window.removeEventListener('keydown', handleShortcut, true)
    }
  }, [cancelRequest, phase, view])

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
