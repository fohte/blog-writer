import { Button } from '@fohte/ui/button'
import { Chip } from '@fohte/ui/chip'
import { List } from '@fohte/ui/list'
import { Panel } from '@fohte/ui/panel'
import { Textarea } from '@fohte/ui/textarea'
import type { ClipboardEvent, DragEvent } from 'react'

import type { Finding, Source } from '#article/index'
import { ResearchSourceCard } from '#components/research-source-card'
import { formatCheckedAt, getSourceHost } from '#research/source-format'

export type PendingSource = { id: string; label: string }

type SourcePanelViewProps = {
  sources: Source[]
  findings: Finding[]
  pending: PendingSource[]
  expandedSourceId: string | null
  openFindingId?: string
  pasteTargetId: string | null
  pastedBody: string
  error?: string | undefined
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onPaste: (event: ClipboardEvent<HTMLElement>) => void
  onToggleSource: (id: string) => void
  onDeleteSource: (id: string) => void
  onPasteTarget: (id: string | null) => void
  onPastedBodyChange: (body: string) => void
  onSavePastedBody: (source: Source) => void
}

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

export function SourcePanelView({
  sources,
  findings,
  pending,
  expandedSourceId,
  openFindingId,
  pasteTargetId,
  pastedBody,
  error,
  onDrop,
  onDragOver,
  onPaste,
  onToggleSource,
  onDeleteSource,
  onPasteTarget,
  onPastedBodyChange,
  onSavePastedBody,
}: SourcePanelViewProps) {
  return (
    <section
      aria-labelledby="source-panel-heading"
      className="flex flex-col gap-3"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPaste={onPaste}
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold" id="source-panel-heading">
          資料
        </h2>
        <span className="text-sm text-muted-foreground">
          {sources.length.toString()} 件
        </span>
      </div>

      <Panel className="flex flex-col gap-2 rounded-lg p-3">
        <p className="text-sm text-muted-foreground">
          URL またはファイルをドロップ、または URL を貼り付け
        </p>
        {error === undefined ? null : <p role="alert">{error}</p>}
        {sources.length === 0 && pending.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            資料はありません。
          </p>
        ) : null}

        <List aria-label="資料一覧">
          {pending.map((item) => (
            <div
              className="flex items-center justify-between gap-2 py-3"
              key={item.id}
              role="listitem"
            >
              <span className="truncate">{item.label}</span>
              <Chip role="status" size="sm" tone="muted">
                取り込み中
              </Chip>
            </div>
          ))}
          {sources.map((source) => {
            const sourceFindings = findings.filter(
              (finding) => finding.sourceId === source.id,
            )
            const isPending = pending.some((item) => item.id === source.id)
            const expanded = expandedSourceId === source.id
            const checkedAt = formatCheckedAt(source.checkedAt)
            return (
              <div
                className="border-b border-border py-3 last:border-b-0"
                key={source.id}
                role="listitem"
              >
                <div className="flex items-start gap-2">
                  <button
                    aria-expanded={expanded}
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      onToggleSource(source.id)
                    }}
                    type="button"
                  >
                    <span className="block truncate font-medium">
                      {source.title}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {getSourceLocation(source)}
                    </span>
                  </button>
                  {source.status === 'unavailable' ? (
                    <Chip size="sm" tone="strong">
                      取得できず
                    </Chip>
                  ) : source.status === 'analysisFailed' ? (
                    <Chip size="sm" tone="strong">
                      要約失敗
                    </Chip>
                  ) : (
                    <Chip size="sm" tone="faint">
                      {checkedAt === undefined
                        ? '確認済み'
                        : `確認 ${checkedAt}`}
                    </Chip>
                  )}
                  <Button
                    aria-label={`資料「${source.title}」を削除`}
                    onClick={() => {
                      onDeleteSource(source.id)
                    }}
                    disabled={isPending}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    ×
                  </Button>
                </div>

                {expanded ? (
                  <div className="mt-3 flex flex-col gap-3 pl-2">
                    {source.status === 'unavailable' ? (
                      <div className="flex flex-col items-start gap-2">
                        <p className="text-sm text-muted-foreground">
                          本文を貼り付けると要約と要点を作成します。
                        </p>
                        <Button
                          onClick={() => {
                            onPasteTarget(
                              pasteTargetId === source.id ? null : source.id,
                            )
                          }}
                          type="button"
                          variant="outline"
                        >
                          {pasteTargetId === source.id
                            ? '貼り付け欄を閉じる'
                            : '本文を貼り付け'}
                        </Button>
                        {pasteTargetId === source.id ? (
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
                              disabled={pastedBody.trim().length === 0}
                              onClick={() => {
                                onSavePastedBody(source)
                              }}
                              type="button"
                            >
                              本文を登録
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : source.status === 'analysisFailed' ? (
                      <p className="text-sm text-muted-foreground">
                        本文は保存済みですが、要約と要点の作成に失敗しました。
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {source.summary || '要約はありません。'}
                      </p>
                    )}
                    {sourceFindings.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        要点はありません。
                      </p>
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
      </Panel>
    </section>
  )
}
