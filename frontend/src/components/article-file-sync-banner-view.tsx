import { Button } from '@fohte/ui/button'
import { Kbd } from '@fohte/ui/kbd'

type ArticleFileSyncBannerViewProps = {
  state: 'external_changed' | 'missing' | 'imported'
  path: string
  busy?: boolean | undefined
  canImport?: boolean | undefined
  error?: string | undefined
  onShowDiff: () => void
  onImport: () => void
  onOverwrite: () => void
  onChangePath: () => void
  onUndo: () => void
}

export function ArticleFileSyncBannerView({
  state,
  path,
  busy = false,
  canImport = false,
  error,
  onShowDiff,
  onImport,
  onOverwrite,
  onChangePath,
  onUndo,
}: ArticleFileSyncBannerViewProps) {
  return (
    <section
      aria-label="ファイル同期"
      className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border border-foreground px-3.5 py-3 text-sm leading-relaxed"
    >
      {state === 'imported' ? (
        <>
          <span className="flex-1 basis-105">
            ファイルの内容を取り込みました
          </span>
          <Button onClick={onUndo} size="xs" type="button" variant="outline">
            元に戻す <Kbd>⌘Z</Kbd>
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 basis-105">
            <span aria-hidden="true" className="font-mono text-primary">
              !
            </span>{' '}
            <span className="font-mono">{path}</span>
            {state === 'missing'
              ? ' が見つかりません。'
              : ' がアプリの外で変更されました。'}
            ファイルへの書き込みだけ止めています。ここでの編集は保存されています。
          </span>
          {state === 'missing' ? (
            <>
              <Button
                disabled={busy}
                onClick={onOverwrite}
                size="xs"
                type="button"
                variant="outline"
              >
                作り直す
              </Button>
              <Button
                onClick={onChangePath}
                size="xs"
                type="button"
                variant="outline"
              >
                パスを指定し直す
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={onShowDiff}
                size="xs"
                type="button"
                variant="outline"
              >
                差分を見る
              </Button>
              <Button
                disabled={busy || !canImport}
                onClick={onImport}
                size="xs"
                type="button"
                variant="outline"
              >
                ファイルの内容を取り込む
              </Button>
              <Button
                disabled={busy}
                onClick={onOverwrite}
                size="xs"
                type="button"
                variant="outline"
              >
                アプリの内容で上書き
              </Button>
            </>
          )}
        </>
      )}
      {error !== undefined && error.length > 0 ? (
        <p
          aria-live="assertive"
          className="basis-full text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  )
}
