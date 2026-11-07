import { errAsync } from 'neverthrow'
import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'

import type { Finding, Source } from '#article/index'
import {
  addSource,
  deleteSource,
  getBody,
  listEvidence,
  listFindings,
  listSources,
  observeEvidence,
  observeSources,
  setFindings,
  updateSource,
} from '#article/index'
import type { ResearchProgressProps } from '#components/research-progress'
import {
  type PendingSource,
  type SourceEvidence,
  SourcePanelView,
} from '#components/source-panel-view'
import { loadLlmSettings } from '#lib/llm-settings'
import { deleteSourceBody } from '#lib/source-api'
import { getSourceHost } from '#research/source-format'
import type { SourceInput } from '#research/source-ingestion'
import {
  importSource,
  SourceAnalysisImportError,
} from '#research/source-ingestion'

type SourcePanelProps = {
  articleId: string
  doc: Y.Doc
  researchProgress?: ResearchProgressProps | undefined
  researchError?: string | undefined
}

type SourceSnapshot = {
  sources: Source[]
  findings: Finding[]
  evidence: SourceEvidence[]
}

function getSnapshot(doc: Y.Doc): SourceSnapshot {
  return {
    sources: listSources(doc),
    findings: listFindings(doc),
    evidence: listEvidence(doc).map(({ sourceId, verdict, edited }) => ({
      sourceId,
      needsReview: edited || verdict !== 'supported',
      edited,
    })),
  }
}

function extractUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>()[\]{}]+/gi)].map(([url]) =>
    url.replace(/[.,;!?]+$/, ''),
  )
}

function urlLabel(url: string): string {
  return getSourceHost(url) ?? url
}

function loadSettings() {
  return loadLlmSettings(() => window.localStorage).mapErr(
    (cause) => new Error('LLM 設定を読み込めませんでした。', { cause }),
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export function SourcePanel({
  articleId,
  doc,
  researchProgress,
  researchError,
}: SourcePanelProps) {
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
    const body = getBody(doc)
    const unobserveSources = observeSources(doc, refresh)
    // A separate listener: both observers watch the sources map, and yjs drops every registration of a listener on its first unobserve.
    const unobserveEvidence = observeEvidence(doc, () => {
      refresh()
    })
    // Editing a checked sentence turns its evidence into "edited after check".
    body.observe(refresh)
    return () => {
      unobserveSources()
      unobserveEvidence()
      body.unobserve(refresh)
    }
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
    const persistSource = (
      fields: Omit<Source, 'id'>,
      existingFields?: Partial<Omit<Source, 'id'>>,
    ) => {
      const saved = existingSource
        ? updateSource(doc, id, existingFields ?? fields)
        : addSource(doc, { id, ...fields })
      saved.match(
        () => undefined,
        () => {
          setError('資料を保存できませんでした。')
        },
      )
    }
    const importResult = loadSettings().match(
      (settings) =>
        importSource(fetch, articleId, id, input, settings, controller.signal),
      (settingsError) => errAsync(settingsError),
    )
    void importResult
      .match(
        (imported) => {
          if (controller.signal.aborted) return
          const sourceFields = {
            ...imported,
            checkedAt: new Date().toISOString(),
            status: 'ready' as const,
          }
          doc.transact(() => {
            persistSource(sourceFields, {
              status: 'ready',
              summary: imported.summary,
              checkedAt: sourceFields.checkedAt,
            })
            const findingsResult = setFindings(
              doc,
              id,
              imported.findings.map((finding, index) => ({
                id: `${id}-${index.toString()}`,
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
          const analysisFailed =
            importError instanceof SourceAnalysisImportError
          setError(
            analysisFailed
              ? `資料本文は保存済みですが、要約と要点の作成に失敗しました: ${importError.message}`
              : importError.message,
          )
          if (analysisFailed) {
            setPastedBody('')
            setPasteTargetId(null)
            const failedSource = {
              ...importError.source,
              checkedAt: new Date().toISOString(),
              status: 'analysisFailed' as const,
              summary: '',
            }
            doc.transact(() => {
              persistSource(failedSource, {
                status: 'analysisFailed',
                summary: '',
                checkedAt: failedSource.checkedAt,
              })
              if (existingSource) {
                setFindings(doc, id, []).match(
                  () => undefined,
                  () => {
                    setError('要点を保存できませんでした。')
                  },
                )
              }
            })
            setExpandedSourceId(id)
          } else if (!existingSource) {
            doc.transact(() => {
              persistSource({
                ...fallback,
                checkedAt: null,
                status: 'unavailable',
                summary: '',
              })
            })
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

  const addUrlsFromText = (text: string) => {
    const urls = extractUrls(text)
    if (urls.length === 0) {
      setError('URL を読み取れませんでした。')
      return false
    }
    urls.forEach(addUrl)
    return true
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
      evidence={snapshot.evidence}
      expandedSourceId={expandedSourceId}
      findings={snapshot.findings}
      onAddFile={addFile}
      onAddUrl={addUrlsFromText}
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
        if (isEditableTarget(event.target)) return
        if (event.dataTransfer.types.length > 0) event.preventDefault()
      }}
      onDrop={(event) => {
        if (isEditableTarget(event.target)) return
        if (handleTransfer(event.dataTransfer)) event.preventDefault()
      }}
      onPaste={(event) => {
        if (isEditableTarget(event.target)) return
        if (handleTransfer(event.clipboardData)) event.preventDefault()
      }}
      onPastedBodyChange={setPastedBody}
      onPasteTarget={(id) => {
        setPasteTargetId(id)
        setPastedBody('')
      }}
      onRetrySource={(source) => {
        beginImport(
          source.id,
          source.title,
          {
            kind: 'stored',
            source: {
              kind: source.kind,
              title: source.title,
              url: source.url,
              fileName: source.fileName,
            },
          },
          source,
          source,
        )
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
      researchProgress={researchProgress}
      researchError={researchError}
      sources={snapshot.sources}
    />
  )
}
