import { Button } from '@fohte/ui/button'
import { Chip } from '@fohte/ui/chip'
import { Input } from '@fohte/ui/input'
import { Panel } from '@fohte/ui/panel'
import { Popover, PopoverContent, PopoverTrigger } from '@fohte/ui/popover'

import { TextDiffView } from '#components/text-diff-view'
import type { ArticleFileSyncStatus } from '#lib/file-sync-api'
import { normalizeLineEndings } from '#lib/normalize-line-endings'

type ArticleFileSyncViewProps = {
  status: ArticleFileSyncStatus
  path: string
  content?: string | null | undefined
  contentHash?: string | null | undefined
  body: string
  open?: boolean | undefined
  busy?: boolean | undefined
  error?: string | undefined
  onOpenChange: (open: boolean) => void
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
  open = false,
  busy = false,
  error,
  onOpenChange,
  onPathChange,
  onSetPath,
  onImport,
  onOverwrite,
}: ArticleFileSyncViewProps) {
  const fileExists = content !== null && content !== undefined
  const showDiff = status === 'external_changed' && fileExists

  return (
    <div className="flex items-center gap-2">
      <Chip
        aria-live="polite"
        data-state={status}
        role="status"
        size="md"
        tone={status === 'external_changed' ? 'strong' : 'muted'}
      >
        {statusLabels[status]}
      </Chip>
      <Popover onOpenChange={onOpenChange} open={open}>
        <PopoverTrigger render={<Button type="button" variant="outline" />}>
          ローカル同期
        </PopoverTrigger>
        <PopoverContent
          className="flex w-96 max-w-full flex-col gap-3"
          style={
            showDiff
              ? { width: '48rem', maxWidth: 'calc(100vw - 2rem)' }
              : undefined
          }
        >
          <h2 className="font-semibold">同期ファイル</h2>
          <div className="flex gap-2">
            <Input
              aria-label="同期ファイルの相対パス"
              autoComplete="off"
              disabled={busy}
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
          {status === 'external_changed' ? (
            fileExists ? (
              <>
                <TextDiffView
                  modified={body}
                  modifiedLabel="記事本文"
                  original={normalizeLineEndings(content)}
                  originalLabel="ファイルの内容"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy || contentHash == null}
                    onClick={onImport}
                    type="button"
                  >
                    取り込む
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={onOverwrite}
                    type="button"
                    variant="outline"
                  >
                    上書き
                  </Button>
                </div>
              </>
            ) : content === null && error === undefined && !busy ? (
              <Panel className="flex flex-col gap-3 rounded-md p-3">
                <p>
                  同期ファイルが見つかりません。上書きして作り直すか、別のパスを指定してください。
                </p>
                <Button disabled={busy} onClick={onOverwrite} type="button">
                  上書きして作り直す
                </Button>
              </Panel>
            ) : null
          ) : null}
          {busy ? (
            <p
              aria-live="polite"
              className="text-muted-foreground"
              role="status"
            >
              同期しています…
            </p>
          ) : null}
          {error !== undefined && error.length > 0 ? (
            <Panel
              aria-live="assertive"
              className="rounded-md border-destructive/40 bg-destructive/10 text-sm text-destructive"
              padding="sm"
              role="alert"
            >
              {error}
            </Panel>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}
