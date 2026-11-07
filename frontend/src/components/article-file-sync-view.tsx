import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { useId } from 'react'

import { TextDiffView } from '#components/text-diff-view'
import type { ArticleFileSyncStatus } from '#lib/file-sync-api'
import { normalizeLineEndings } from '#lib/normalize-line-endings'

type ArticleFileSyncViewProps = {
  status: ArticleFileSyncStatus
  path: string
  content?: string | null | undefined
  contentHash?: string | null | undefined
  body: string
  busy?: boolean | undefined
  error?: string | undefined
  onPathChange: (path: string) => void
  onSetPath: () => void
  onImport: () => void
  onOverwrite: () => void
}

const statusLabels: Record<ArticleFileSyncStatus, string> = {
  unset: '未設定',
  synced: '同期済み',
  external_changed: '外部で変更あり',
}

export function ArticleFileSyncView({
  status,
  path,
  content,
  contentHash,
  body,
  busy = false,
  error,
  onPathChange,
  onSetPath,
  onImport,
  onOverwrite,
}: ArticleFileSyncViewProps) {
  const pathId = useId()
  const fileExists = content !== null && content !== undefined

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed text-muted-foreground-strong">
        本文を編集すると、このファイルに自動で書き込みます。ファイル側の変更は自動では取り込みません。
      </p>
      <p className="font-mono text-xs text-muted-foreground-strong">
        状態{' '}
        <span
          aria-live="polite"
          className="text-foreground"
          data-state={status}
          role="status"
        >
          {statusLabels[status]}
        </span>
      </p>
      <div className="flex flex-col gap-1.5">
        <label
          className="text-xs font-bold text-muted-foreground-strong"
          htmlFor={pathId}
        >
          同期フォルダー配下のパス
        </label>
        <div className="flex gap-2">
          <Input
            autoComplete="off"
            className="font-mono"
            disabled={busy}
            id={pathId}
            onChange={(event) => {
              onPathChange(event.currentTarget.value)
            }}
            placeholder="notes/example.md"
            value={path}
          />
          <Button
            disabled={busy || path.trim().length === 0}
            onClick={onSetPath}
            type="button"
            variant="outline"
          >
            指定
          </Button>
        </div>
      </div>
      {status === 'external_changed' && fileExists ? (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-bold">ファイルとの差分</h2>
            <TextDiffView
              modified={body}
              modifiedLabel="アプリの本文"
              original={normalizeLineEndings(content)}
              originalLabel="ファイルの内容"
            />
          </section>
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <span className="flex-1 basis-75 text-sm leading-relaxed text-muted-foreground-strong">
              ファイルへの書き込みだけ止めています。取り込んだ内容は 1
              回の取り消しで戻せます。
            </span>
            <Button
              disabled={busy}
              onClick={onOverwrite}
              type="button"
              variant="outline"
            >
              アプリの内容で上書き
            </Button>
            <Button
              disabled={busy || contentHash == null}
              onClick={onImport}
              type="button"
              variant="solid"
            >
              ファイルの内容を取り込む
            </Button>
          </div>
        </>
      ) : null}
      {status === 'external_changed' &&
      content === null &&
      error === undefined &&
      !busy ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <span className="flex-1 basis-75 text-sm leading-relaxed text-muted-foreground-strong">
            同期先のファイルが見つかりません。作り直すか、パスを指定し直してください。
          </span>
          <Button onClick={onOverwrite} type="button" variant="solid">
            作り直す
          </Button>
        </div>
      ) : null}
      {busy ? (
        <p
          aria-live="polite"
          className="text-sm text-muted-foreground-strong"
          role="status"
        >
          同期しています…
        </p>
      ) : null}
      {error !== undefined && error.length > 0 ? (
        <p
          aria-live="assertive"
          className="text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
