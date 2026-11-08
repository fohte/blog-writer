import { Button } from '@fohte/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@fohte/ui/dialog'

import { TRASH_RETENTION_MS } from '#article/constants'
import { formatLocalDate } from '#lib/format-local-date'
import type { TrashedArticle } from '#lib/sync-client'

export interface ArticleTrashDialogProps {
  articles: TrashedArticle[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestore: (id: string) => void
}

export function ArticleTrashDialog({
  articles,
  open,
  onOpenChange,
  onRestore,
}: ArticleTrashDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogTitle>ゴミ箱</DialogTitle>
        {articles.length === 0 ? (
          <p className="text-sm">ゴミ箱は空です</p>
        ) : (
          <ul className="border-t border-border">
            {articles.map(({ id, title, trashedAt }) => (
              <li
                className="flex items-center gap-3 border-b border-border py-3"
                key={id}
              >
                <div className="flex min-w-0 grow flex-col gap-1">
                  <span className="text-sm font-bold wrap-anywhere">
                    {title}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground-strong">
                    {formatLocalDate(trashedAt + TRASH_RETENTION_MS)} に消えます
                  </span>
                </div>
                <Button
                  onClick={() => {
                    onRestore(id)
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  戻す
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
