import { Button } from '@fohte/ui/button'
import { SettingsIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type AppHeaderProps = {
  status?: ReactNode
  articleTitle?: string | undefined
  actions?: ReactNode
  onHome?: (() => void) | undefined
  onOpenSettings: () => void
}

export function AppHeader({
  status,
  articleTitle,
  actions,
  onHome,
  onOpenSettings,
}: AppHeaderProps) {
  const logo = (
    <>
      <span aria-hidden="true" className="text-primary">
        &gt;
      </span>
      blog-writer
    </>
  )

  return (
    <header className="flex min-h-12 flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-4 py-2">
      {onHome ? (
        <button
          className="flex gap-1.5 font-mono text-sm font-bold"
          onClick={onHome}
          title="記事の一覧へ"
          type="button"
        >
          {logo}
        </button>
      ) : (
        <span className="flex gap-1.5 font-mono text-sm font-bold">{logo}</span>
      )}
      {articleTitle === undefined ? (
        <span className="flex-1" />
      ) : (
        <span className="min-w-0 flex-1 basis-60 truncate text-sm text-muted-foreground-strong">
          記事 / {articleTitle}
        </span>
      )}
      {status}
      {actions}
      <Button
        aria-label="設定"
        onClick={onOpenSettings}
        size="icon"
        type="button"
        variant="outline"
      >
        <SettingsIcon />
      </Button>
    </header>
  )
}
