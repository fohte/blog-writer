import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { List } from '@fohte/ui/list'
import { Textarea } from '@fohte/ui/textarea'
import {
  type ClipboardEvent,
  type DragEvent,
  type SyntheticEvent,
  useRef,
} from 'react'

import type { Finding, Source } from '#article/index'
import {
  ResearchProgress,
  type ResearchProgressProps,
} from '#components/research-progress'
import { ResearchSourceCard } from '#components/research-source-card'
import { formatCheckedAt, getSourceHost } from '#research/source-format'

export type PendingSource = { id: string; label: string }

export type SourceEvidence = {
  sourceId: string | null
  needsReview: boolean
  edited: boolean
}

type SourcePanelViewProps = {
  sources: Source[]
  findings: Finding[]
  evidence: SourceEvidence[]
  pending: PendingSource[]
  expandedSourceId: string | null
  openFindingId?: string
  pasteTargetId: string | null
  pastedBody: string
  error?: string | undefined
  onAddUrl: (text: string) => boolean
  onAddFile: (file: File) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onPaste: (event: ClipboardEvent<HTMLElement>) => void
  onToggleSource: (id: string) => void
  onDeleteSource: (id: string) => void
  onPasteTarget: (id: string | null) => void
  onPastedBodyChange: (body: string) => void
  onSavePastedBody: (source: Source) => void
  onRetrySource: (source: Source) => void
  researchProgress?: ResearchProgressProps | undefined
  researchError?: string | undefined
  /** ISO time this device last left the sources tab, or null if it never opened it. */
  seenAt?: string | null | undefined
}

// Mirrors the extensions the source body import accepts.
const acceptedFileTypes = '.pdf,.md,.markdown,.txt'
const importingLabel = '取り込み中 · 要点を抽出中'

function getSourceLocation(source: Source): string {
  if (source.url !== null) {
    return getSourceHost(source.url) ?? 'Web ページ'
  }
  if (source.fileName !== null) {
    const extension = source.fileName.split('.').at(-1)
    return extension !== undefined && extension.length > 0
      ? extension.toUpperCase()
      : 'ファイル'
  }
  return '貼り付けた資料'
}

function getSourceState(source: Source, importing: boolean): string {
  if (importing) return importingLabel
  if (source.status === 'unavailable') return '取得できず'
  if (source.status === 'analysisFailed') return '要約失敗'
  const checkedAt = formatCheckedAt(source.checkedAt)
  return checkedAt === undefined ? '取得済み' : `取得 ${checkedAt}`
}

function countEvidence(evidence: SourceEvidence[], sourceId: string) {
  const items = evidence.filter((item) => item.sourceId === sourceId)
  return {
    total: items.length,
    needsReview: items.filter((item) => item.needsReview).length,
    edited: items.filter((item) => item.edited).length,
  }
}

export function SourcePanelView({
  sources,
  findings,
  evidence,
  pending,
  expandedSourceId,
  openFindingId,
  pasteTargetId,
  pastedBody,
  error,
  onAddUrl,
  onAddFile,
  onDrop,
  onDragOver,
  onPaste,
  onToggleSource,
  onDeleteSource,
  onPasteTarget,
  onPastedBodyChange,
  onSavePastedBody,
  onRetrySource,
  researchProgress,
  researchError,
  seenAt = null,
}: SourcePanelViewProps) {
  const fileInput = useRef<HTMLInputElement>(null)

  const submitUrl = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const url = new FormData(form).get('url')
    if (typeof url === 'string' && onAddUrl(url)) form.reset()
  }

  return (
    <section
      aria-labelledby="source-panel-heading"
      className="flex flex-col gap-3"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPaste={onPaste}
      tabIndex={0}
    >
      <h2 className="sr-only" id="source-panel-heading">
        資料
      </h2>
      {researchError === undefined ? null : <p role="alert">{researchError}</p>}
      {error === undefined ? null : <p role="alert">{error}</p>}
      {researchProgress === undefined ? null : (
        <ResearchProgress {...researchProgress} />
      )}

      <form className="flex gap-2" onSubmit={submitUrl}>
        <Input
          aria-label="URL を追加"
          className="min-w-0 flex-1"
          name="url"
          placeholder="URL を貼って追加"
        />
        <Button
          onClick={() => {
            fileInput.current?.click()
          }}
          type="button"
          variant="outline"
        >
          ファイル
        </Button>
        <input
          accept={acceptedFileTypes}
          aria-label="ファイルを追加"
          className="hidden"
          multiple
          onChange={(event) => {
            const input = event.currentTarget
            ;[...(input.files ?? [])].forEach(onAddFile)
            input.value = ''
          }}
          ref={fileInput}
          type="file"
        />
      </form>

      {sources.length === 0 && pending.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          資料はありません。URL やファイルを追加すると、要約と要点を作ります。
        </p>
      ) : null}

      <List aria-label="資料一覧">
        {pending
          .filter(({ id }) => !sources.some((source) => source.id === id))
          .map((item) => (
            <div
              className="flex flex-col gap-0.5 border-b border-border px-2 py-2.5 text-sm last:border-b-0"
              key={item.id}
              role="listitem"
            >
              <span className="truncate font-semibold text-muted-foreground">
                {item.label}
              </span>
              <p
                className="font-mono text-xs text-muted-foreground"
                role="status"
              >
                {importingLabel}
              </p>
            </div>
          ))}
        {sources.map((source) => {
          const sourceFindings = findings.filter(
            (finding) => finding.sourceId === source.id,
          )
          const counts = countEvidence(evidence, source.id)
          const isPending = pending.some((item) => item.id === source.id)
          // Only an analyzed source has a summary and findings to open.
          const openable = source.status === 'ready'
          const expanded = openable && expandedSourceId === source.id
          const pasting = pasteTargetId === source.id
          const details = [
            getSourceLocation(source),
            getSourceState(source, isPending),
            ...(counts.edited > 0
              ? [`確認後に編集 ${counts.edited.toString()}`]
              : []),
          ]
          return (
            <div
              className="flex flex-col gap-0.5 border-b border-border px-2 py-2.5 text-sm last:border-b-0"
              key={source.id}
              role="listitem"
            >
              <div className="flex items-start gap-2">
                {openable ? (
                  <button
                    aria-expanded={expanded}
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      onToggleSource(source.id)
                    }}
                    type="button"
                  >
                    <span className="block truncate font-semibold">
                      {source.title}
                    </span>
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {source.title}
                  </span>
                )}
                {counts.total > 0 ? (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    根拠 {counts.total}
                    {counts.needsReview > 0
                      ? ` · 要確認 ${counts.needsReview.toString()}`
                      : null}
                  </span>
                ) : null}
                {source.addedAt !== null && source.addedAt > (seenAt ?? '') ? (
                  <span className="shrink-0 font-mono text-xs">新規</span>
                ) : null}
                <Button
                  aria-label={`資料「${source.title}」を削除`}
                  className="-my-1"
                  disabled={isPending}
                  onClick={() => {
                    onDeleteSource(source.id)
                  }}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  ×
                </Button>
              </div>
              <p
                className="truncate font-mono text-xs text-muted-foreground"
                role={isPending ? 'status' : undefined}
              >
                {details.join(' · ')}
              </p>

              {source.status === 'unavailable' && !isPending ? (
                <div className="mt-1 flex flex-col items-start gap-2">
                  <Button
                    onClick={() => {
                      onPasteTarget(pasting ? null : source.id)
                    }}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    {pasting ? '貼り付け欄を閉じる' : '本文を貼り付けて登録'}
                  </Button>
                  {pasting ? (
                    <div className="flex w-full flex-col gap-2">
                      <Textarea
                        aria-label="資料本文"
                        onChange={(event) => {
                          onPastedBodyChange(event.currentTarget.value)
                        }}
                        placeholder="資料の本文を貼り付け"
                        value={pastedBody}
                      />
                      <Button
                        className="self-start"
                        disabled={pastedBody.trim().length === 0}
                        onClick={() => {
                          onSavePastedBody(source)
                        }}
                        size="sm"
                        type="button"
                      >
                        本文を登録
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {source.status === 'analysisFailed' && !isPending ? (
                <Button
                  className="mt-1 self-start"
                  onClick={() => {
                    onRetrySource(source)
                  }}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  要約をやり直す
                </Button>
              ) : null}

              {expanded ? (
                <div className="mt-2 flex flex-col gap-2 pl-2">
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {source.summary || '要約はありません。'}
                  </p>
                  {sourceFindings.length === 0 ? (
                    <p className="text-muted-foreground">要点はありません。</p>
                  ) : (
                    <List aria-label={`${source.title}の要点`}>
                      {sourceFindings.map((finding) => (
                        <ResearchSourceCard
                          key={finding.id}
                          finding={finding}
                          open={
                            openFindingId === undefined
                              ? undefined
                              : openFindingId === finding.id
                          }
                          source={source}
                        />
                      ))}
                    </List>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </List>
    </section>
  )
}
