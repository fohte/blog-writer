import { EditorView, ViewPlugin } from '@codemirror/view'
import { errAsync } from 'neverthrow'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { addEvidence } from '#article/evidence'
import { registerBlockMoveUpdater } from '#article/move-block'
import { addSource, type AddSourceInput } from '#article/sources'
import { droppedClaim } from '#editor/evidence-range'
import { loadLlmSettings } from '#lib/llm-settings'
import { failedFetchStatus } from '#lib/source-api'
import {
  ClaimEvidenceImportError,
  importClaimEvidence,
  type ImportedClaimEvidence,
} from '#research/claim-evidence'

type DropPlugin = {
  handleDrop(event: DragEvent, view: EditorView): boolean
  startInternalDrag(): void
  endInternalDrag(): void
  destroy(): void
}

type EvidenceDropOptions = {
  fetcher?: typeof fetch
  loadSettings?: () => ReturnType<typeof loadLlmSettings>
  newId?: () => string
}

type TextRange = { from: number; to: number }

function trackRange(
  doc: Y.Doc,
  body: Y.Text,
  fromIndex: number,
  toIndex: number,
): { current: () => TextRange | undefined; unregister: () => void } {
  let from = Y.createRelativePositionFromTypeIndex(body, fromIndex, 1)
  let to = Y.createRelativePositionFromTypeIndex(body, toIndex, -1)
  const unregisterUpdater = registerBlockMoveUpdater(doc, (mapping) => {
    const start = Y.createAbsolutePositionFromRelativePosition(from, doc)
    const end = Y.createAbsolutePositionFromRelativePosition(to, doc)
    const nextFrom =
      start?.type === body ? mapping.mapPosition(start.index) : undefined
    const nextTo =
      end?.type === body ? mapping.mapRangeEnd(end.index) : undefined
    return () => {
      if (nextFrom !== undefined)
        from = Y.createRelativePositionFromTypeIndex(body, nextFrom, 1)
      if (nextTo !== undefined)
        to = Y.createRelativePositionFromTypeIndex(body, nextTo, -1)
    }
  })
  let registered = true

  return {
    current() {
      const start = Y.createAbsolutePositionFromRelativePosition(from, doc)
      const end = Y.createAbsolutePositionFromRelativePosition(to, doc)
      return start &&
        end &&
        start.type === body &&
        end.type === body &&
        end.index > start.index
        ? { from: start.index, to: end.index }
        : undefined
    },
    unregister() {
      if (!registered) return
      registered = false
      unregisterUpdater()
    },
  }
}

function saveSource(
  doc: Y.Doc,
  sourceId: string,
  source: Omit<AddSourceInput, 'id'>,
  saveError: string,
  onError: (message: string) => void,
): boolean {
  return addSource(doc, { id: sourceId, ...source }).match(
    () => true,
    () => {
      onError(saveError)
      return false
    },
  )
}

function saveJudgement(
  doc: Y.Doc,
  sourceId: string,
  claim: string,
  imported: ImportedClaimEvidence,
  range: TextRange | undefined,
  newId: () => string,
  onError: (message: string) => void,
): void {
  const checkedAt = new Date().toISOString()
  doc.transact(() => {
    if (
      !saveSource(
        doc,
        sourceId,
        {
          kind: 'url',
          title: imported.title,
          url: imported.url,
          fileName: null,
          checkedAt,
          publishedAt: imported.publishedAt,
          status: 'ready',
        },
        '資料を保存できませんでした。',
        onError,
      )
    )
      return
    if (!range) {
      onError('対象の文が変更されたため、資料のみ登録しました。')
      return
    }
    addEvidence(doc, {
      id: newId(),
      ...range,
      claim,
      sourceId,
      quote: imported.quote,
      verdict: imported.verdict,
      checkedAt,
    }).match(
      () => undefined,
      () => {
        onError('根拠を保存できませんでした。')
      },
    )
  })
}

function saveImportFailure(
  doc: Y.Doc,
  sourceId: string,
  error: Error,
  onError: (message: string) => void,
): void {
  if (error instanceof ClaimEvidenceImportError) {
    const sourceFailure = error.phase === 'source'
    saveSource(
      doc,
      sourceId,
      {
        kind: 'url',
        title: error.title,
        url: error.url,
        fileName: null,
        checkedAt: sourceFailure ? null : new Date().toISOString(),
        status: sourceFailure ? failedFetchStatus(error) : 'analysisFailed',
        summary: '',
      },
      sourceFailure
        ? '取得できない資料を保存できませんでした。'
        : '判定に失敗した資料を保存できませんでした。',
      onError,
    )
    if (sourceFailure) onError(error.message)
    else
      onError(
        `資料は登録しましたが、根拠を判定できませんでした: ${error.message}`,
      )
    return
  }
  onError(error.message)
}

export function evidenceDrop(
  doc: Y.Doc,
  articleId: string,
  onError: (message: string) => void,
  onStart: () => void,
  options: EvidenceDropOptions = {},
) {
  const fetcher = options.fetcher ?? fetch
  const loadSettings =
    options.loadSettings ?? (() => loadLlmSettings(() => window.localStorage))
  const newId = options.newId ?? (() => crypto.randomUUID())
  const plugins = new WeakMap<EditorView, DropPlugin>()
  const plugin = ViewPlugin.define<DropPlugin>(
    (view) => {
      const controllers = new Map<AbortController, () => void>()
      const body = getBody(doc)
      let internalDrag = false
      const cancelPending = () => {
        for (const [controller, unregister] of controllers) {
          controller.abort()
          unregister()
        }
        controllers.clear()
      }
      const cancel = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        cancelPending()
      }
      window.addEventListener('keydown', cancel)
      window.addEventListener('offline', cancelPending)

      const instance: DropPlugin = {
        handleDrop(event, editorView) {
          if (internalDrag) {
            internalDrag = false
            return false
          }
          if (!event.dataTransfer) return false
          const position = editorView.posAtCoords({
            x: event.clientX,
            y: event.clientY,
          })
          if (position === null) return false
          const target = droppedClaim(
            editorView.state.doc.toString(),
            event.dataTransfer,
            position,
          )
          if (!target) return false
          event.preventDefault()
          onStart()

          const sourceId = newId()
          const controller = new AbortController()
          const range = trackRange(doc, body, target.from, target.to)
          controllers.set(controller, range.unregister)
          const result = loadSettings().match(
            (settings) =>
              importClaimEvidence(
                fetcher,
                articleId,
                sourceId,
                target.url,
                target.claim,
                settings,
                controller.signal,
              ),
            (error) => errAsync(error),
          )

          void result
            .match(
              (imported) => {
                if (controller.signal.aborted) return
                saveJudgement(
                  doc,
                  sourceId,
                  target.claim,
                  imported,
                  range.current(),
                  newId,
                  onError,
                )
              },
              (error) => {
                if (controller.signal.aborted) return
                saveImportFailure(doc, sourceId, error, onError)
              },
            )
            .finally(() => {
              controllers.delete(controller)
              range.unregister()
            })

          return true
        },
        startInternalDrag() {
          internalDrag = true
        },
        endInternalDrag() {
          internalDrag = false
        },
        destroy() {
          window.removeEventListener('keydown', cancel)
          window.removeEventListener('offline', cancelPending)
          cancelPending()
        },
      }
      plugins.set(view, instance)
      return instance
    },
    {
      eventHandlers: {
        dragstart(_event, view) {
          plugins.get(view)?.startInternalDrag()
        },
        dragend(_event, view) {
          plugins.get(view)?.endInternalDrag()
        },
        drop(event, view) {
          return plugins.get(view)?.handleDrop(event, view) ?? false
        },
      },
    },
  )

  return [plugin]
}
