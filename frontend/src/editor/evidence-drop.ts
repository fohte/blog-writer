import { EditorView, ViewPlugin } from '@codemirror/view'
import { errAsync } from 'neverthrow'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { addEvidence } from '#article/evidence'
import { registerBlockMoveUpdater } from '#article/move-block'
import { addSource } from '#article/sources'
import { droppedClaim } from '#editor/evidence-range'
import { loadLlmSettings } from '#lib/llm-settings'
import { importClaimEvidence } from '#research/claim-evidence'

type DropPlugin = {
  handleDrop(event: DragEvent, view: EditorView): boolean
  destroy(): void
}

export function evidenceDrop(
  doc: Y.Doc,
  articleId: string,
  onError: (message: string) => void,
  onStart: () => void,
) {
  const plugins = new WeakMap<EditorView, DropPlugin>()
  const plugin = ViewPlugin.define<DropPlugin>(
    (view) => {
      const controllers = new Map<AbortController, () => void>()
      const body = getBody(doc)
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

          const sourceId = crypto.randomUUID()
          const controller = new AbortController()
          const from = Y.createRelativePositionFromTypeIndex(
            body,
            target.from,
            1,
          )
          const to = Y.createRelativePositionFromTypeIndex(body, target.to, -1)
          let pendingFrom = from
          let pendingTo = to
          const unregisterMoveUpdater = registerBlockMoveUpdater(
            doc,
            (mapping) => {
              const start = Y.createAbsolutePositionFromRelativePosition(
                pendingFrom,
                doc,
              )
              const end = Y.createAbsolutePositionFromRelativePosition(
                pendingTo,
                doc,
              )
              const nextFrom =
                start?.type === body
                  ? mapping.mapPosition(start.index)
                  : undefined
              const nextTo =
                end?.type === body ? mapping.mapPosition(end.index) : undefined
              return () => {
                if (nextFrom !== undefined)
                  pendingFrom = Y.createRelativePositionFromTypeIndex(
                    body,
                    nextFrom,
                    1,
                  )
                if (nextTo !== undefined)
                  pendingTo = Y.createRelativePositionFromTypeIndex(
                    body,
                    nextTo,
                    -1,
                  )
              }
            },
          )
          controllers.set(controller, unregisterMoveUpdater)
          const settings = loadLlmSettings(() => window.localStorage)
          const result = settings.match(
            (value) =>
              importClaimEvidence(
                fetch,
                articleId,
                sourceId,
                target.url,
                target.claim,
                value,
                controller.signal,
              ),
            (error) => errAsync(error),
          )

          void result
            .match(
              (imported) => {
                if (controller.signal.aborted) return
                const start = Y.createAbsolutePositionFromRelativePosition(
                  pendingFrom,
                  doc,
                )
                const end = Y.createAbsolutePositionFromRelativePosition(
                  pendingTo,
                  doc,
                )
                const range =
                  start &&
                  end &&
                  start.type === body &&
                  end.type === body &&
                  end.index > start.index
                    ? { from: start.index, to: end.index }
                    : undefined
                const checkedAt = new Date().toISOString()
                doc.transact(() => {
                  addSource(doc, {
                    id: sourceId,
                    kind: 'url',
                    title: imported.title,
                    url: imported.url,
                    fileName: null,
                    checkedAt,
                    status: 'ready',
                  }).match(
                    () => {
                      if (!range) {
                        onError(
                          '対象の文が変更されたため、資料のみ登録しました。',
                        )
                        return
                      }
                      addEvidence(doc, {
                        id: crypto.randomUUID(),
                        from: range.from,
                        to: range.to,
                        claim: target.claim,
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
                    },
                    () => {
                      onError('資料を保存できませんでした。')
                    },
                  )
                })
              },
              (error) => {
                if (controller.signal.aborted) return
                if ('phase' in error && error.phase === 'source') {
                  addSource(doc, {
                    id: sourceId,
                    kind: 'url',
                    title: error.title,
                    url: error.url,
                    fileName: null,
                    checkedAt: null,
                    status: 'unavailable',
                    summary: '',
                  }).match(
                    () => undefined,
                    () => {
                      onError('取得できない資料を保存できませんでした。')
                    },
                  )
                } else if ('phase' in error && error.phase === 'judgement') {
                  addSource(doc, {
                    id: sourceId,
                    kind: 'url',
                    title: error.title,
                    url: error.url,
                    fileName: null,
                    checkedAt: new Date().toISOString(),
                    status: 'analysisFailed',
                    summary: '',
                  }).match(
                    () => undefined,
                    () => {
                      onError('判定に失敗した資料を保存できませんでした。')
                    },
                  )
                  onError(
                    `資料は登録しましたが、根拠を判定できませんでした: ${error.message}`,
                  )
                }
                if (!('phase' in error) || error.phase === 'source')
                  onError(error.message)
              },
            )
            .finally(() => {
              controllers.delete(controller)
              unregisterMoveUpdater()
            })

          return true
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
        drop(event, view) {
          return plugins.get(view)?.handleDrop(event, view) ?? false
        },
      },
    },
  )

  return [plugin]
}
