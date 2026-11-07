import { Button } from '@fohte/ui/button'
import { List } from '@fohte/ui/list'
import { Popover, PopoverContent, PopoverTrigger } from '@fohte/ui/popover'
import { useEffect, useState } from 'react'

export type ResearchProgressStatus =
  'running' | 'saving' | 'cancelling' | 'complete' | 'interrupted' | 'failed'

export type ResearchProgressProps = {
  status: ResearchProgressStatus
  queries: string[]
  error?: string | undefined
  defaultOpen?: boolean | undefined
  onCancel?: (() => void) | undefined
}

const statusLabels: Record<ResearchProgressStatus, string> = {
  running: '調査中',
  saving: '資料を保存しています',
  cancelling: '調査を中断しています',
  complete: '調査が完了しました',
  interrupted: '調査を中断しました',
  failed: '調査に失敗しました',
}

export function ResearchProgress({
  status,
  queries,
  error,
  defaultOpen = false,
  onCancel,
}: ResearchProgressProps) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (
      status === 'running' ||
      status === 'saving' ||
      status === 'cancelling' ||
      status === 'interrupted' ||
      status === 'failed'
    )
      setOpen(true)
    if (status === 'complete') setOpen(false)
  }, [status])

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={<Button size="sm" type="button" variant="outline" />}
      >
        {statusLabels[status]}
      </PopoverTrigger>
      <PopoverContent className="flex w-80 max-w-full flex-col gap-3">
        <h3 className="font-semibold">調査の進捗</h3>
        {queries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            検索を準備しています。
          </p>
        ) : (
          <List aria-label="検索の進捗">
            {queries.map((query, index) => (
              <li
                className="list-inside py-1 text-sm"
                key={`${index.toString()}-${query}`}
              >
                {query}
              </li>
            ))}
          </List>
        )}
        {status === 'interrupted' ? (
          <>
            <p role="status">調査を中断しました。資料は保存されていません。</p>
            {error !== undefined ? <p role="alert">{error}</p> : null}
          </>
        ) : null}
        {status === 'failed' && error !== undefined ? (
          <p role="alert">{error}</p>
        ) : null}
        {(status === 'running' || status === 'saving') && onCancel ? (
          <Button onClick={onCancel} type="button" variant="outline">
            中止
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
