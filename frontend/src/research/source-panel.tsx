import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'

import type { Finding, Source } from '#article/index'
import {
  addSource,
  deleteSource,
  listFindings,
  listSources,
  observeSources,
  setFindings,
  updateSource,
} from '#article/index'
import {
  type PendingSource,
  SourcePanelView,
} from '#components/source-panel-view'
import { defaultLlmSettings, loadLlmSettings } from '#lib/llm-settings'
import { deleteSourceBody } from '#lib/source-api'
import type { SourceInput } from '#research/source-ingestion'
import { importSource } from '#research/source-ingestion'

type SourcePanelProps = {
  articleId: string
  doc: Y.Doc
}

type SourceSnapshot = { sources: Source[]; findings: Finding[] }

function getSnapshot(doc: Y.Doc): SourceSnapshot {
  return { sources: listSources(doc), findings: listFindings(doc) }
}

function extractUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>()[\]{}]+/gi)].map(([url]) =>
    url.replace(/[.,;!?]+$/, ''),
  )
}

function urlLabel(url: string): string {
  return url.match(/^https?:\/\/([^/:?#]+)/i)?.[1] ?? url
}

function loadSettings() {
  return loadLlmSettings(() => window.localStorage).match(
    (settings) => settings,
    () => defaultLlmSettings,
  )
}

export function SourcePanel({ articleId, doc }: SourcePanelProps) {
  const [snapshot, setSnapshot] = useState(() => getSnapshot(doc))
  const [pending, setPending] = useState<PendingSource[]>([])
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [pasteTargetId, setPasteTargetId] = useState<string | null>(null)
  const [pastedBody, setPastedBody] = useState('')
  const [error, setError] = useState<string>()
  const requests = useRef(new Map<string, AbortController>())

  useEffect(() => {
    const refresh = () => {
      setSnapshot(getSnapshot(doc))
    }
    refresh()
    return observeSources(doc, refresh)
  }, [doc])

  useEffect(
    () => () => {
      for (const controller of requests.current.values()) controller.abort()
      requests.current.clear()
    },
    [],
  )

  const beginImport = (
    id: string,
    label: string,
    input: SourceInput,
    fallback: Pick<Source, 'kind' | 'title' | 'url' | 'fileName'>,
    existingSource?: Source,
  ) => {
    const controller = new AbortController()
    requests.current.set(id, controller)
    setError(undefined)
    setPending((current) => [...current, { id, label }])
    void importSource(
      fetch,
      articleId,
      id,
      input,
      loadSettings(),
      controller.signal,
    )
      .match(
        (imported) => {
          if (controller.signal.aborted) return
          const sourceFields = {
            ...imported,
            checkedAt: new Date().toISOString(),
            status: 'ready' as const,
          }
          doc.transact(() => {
            const sourceResult = existingSource
              ? updateSource(doc, id, {
                  status: 'ready',
                  summary: imported.summary,
                  checkedAt: sourceFields.checkedAt,
                })
              : addSource(doc, { id, ...sourceFields })
            sourceResult.match(
              () => undefined,
              () => {
                setError('資料を保存できませんでした。')
              },
            )
            const findingsResult = setFindings(
              doc,
              id,
              imported.findings.map((finding, index) => ({
                id: `${id}-${index.toString()}`,
                sourceId: id,
                ...finding,
              })),
            )
            findingsResult.match(
              () => undefined,
              () => {
                setError('要点を保存できませんでした。')
              },
            )
          })
          setPastedBody('')
          setPasteTargetId(null)
          setExpandedSourceId(id)
        },
        (importError) => {
          if (controller.signal.aborted) return
          setError(importError.message)
          if (!existingSource) {
            const added = addSource(doc, {
              id,
              ...fallback,
              checkedAt: null,
              status: 'unavailable',
              summary: '',
            })
            added.match(
              () => undefined,
              () => {
                setError('資料を保存できませんでした。')
              },
            )
            setExpandedSourceId(id)
          }
        },
      )
      .finally(() => {
        requests.current.delete(id)
        setPending((current) => current.filter((item) => item.id !== id))
      })
  }

  const addUrl = (url: string) => {
    const id = crypto.randomUUID()
    const title = urlLabel(url)
    beginImport(
      id,
      title,
      { kind: 'url', url },
      { kind: 'url', title, url, fileName: null },
    )
  }

  const addFile = (file: File) => {
    const id = crypto.randomUUID()
    const title = file.name.replace(/\.[^.]+$/, '') || file.name
    beginImport(
      id,
      file.name,
      { kind: 'file', file },
      { kind: 'file', title, url: null, fileName: file.name },
    )
  }

  const handleTransfer = (transfer: DataTransfer) => {
    const files = [...transfer.files]
    const urls = extractUrls(
      transfer.getData('text/uri-list') || transfer.getData('text/plain'),
    )
    if (files.length === 0 && urls.length === 0) return false
    files.forEach(addFile)
    urls.forEach(addUrl)
    return true
  }

  return (
    <SourcePanelView
      error={error}
      expandedSourceId={expandedSourceId}
      findings={snapshot.findings}
      onDeleteSource={(id) => {
        void deleteSourceBody(fetch, articleId, id).match(
          () => {
            const deleted = deleteSource(doc, id)
            if (deleted.isErr()) {
              setError('資料を削除できませんでした。')
              return
            }
            if (expandedSourceId === id) setExpandedSourceId(null)
          },
          (deleteError) => {
            setError(deleteError.message)
          },
        )
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.length > 0) event.preventDefault()
      }}
      onDrop={(event) => {
        if (handleTransfer(event.dataTransfer)) event.preventDefault()
      }}
      onPaste={(event) => {
        const target = event.target
        if (
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLInputElement ||
          (target instanceof HTMLElement && target.isContentEditable)
        ) {
          return
        }
        if (handleTransfer(event.clipboardData)) event.preventDefault()
      }}
      onPastedBodyChange={setPastedBody}
      onPasteTarget={(id) => {
        setPasteTargetId(id)
        setPastedBody('')
      }}
      onSavePastedBody={(source) => {
        const body = pastedBody.trim()
        if (body.length === 0) return
        beginImport(
          source.id,
          source.title,
          { kind: 'pasted', title: source.title, body, url: source.url },
          source,
          source,
        )
      }}
      onToggleSource={(id) => {
        setExpandedSourceId((current) => (current === id ? null : id))
      }}
      pasteTargetId={pasteTargetId}
      pastedBody={pastedBody}
      pending={pending}
      sources={snapshot.sources}
    />
  )
}
