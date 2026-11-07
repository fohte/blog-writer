import { Button } from '@fohte/ui/button'

export type ResearchProgressStatus =
  'running' | 'saving' | 'cancelling' | 'complete' | 'interrupted' | 'failed'

export type ResearchProgressProps = {
  status: ResearchProgressStatus
  queries: string[]
  target?: string | undefined
  error?: string | undefined
  interruptedMessage?: string | undefined
  onCancel?: (() => void) | undefined
}

const statusLabels: Record<ResearchProgressStatus, string> = {
  running: '調べています',
  saving: '資料を保存しています',
  cancelling: '調査を中断しています',
  complete: '調査が完了しました',
  interrupted: '調査を中断しました',
  failed: '調査に失敗しました',
}

export function ResearchProgress({
  status,
  queries,
  target,
  error,
  interruptedMessage,
  onCancel,
}: ResearchProgressProps) {
  const active = status === 'running' || status === 'saving'
  return (
    <div className="flex flex-col gap-1.5 border border-border bg-card p-3 text-xs">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {statusLabels[status]}
          {target !== undefined && target.length > 0 ? ` · ${target}` : null}
        </h3>
        {active && onCancel ? (
          <Button onClick={onCancel} size="xs" type="button" variant="outline">
            中止
          </Button>
        ) : null}
      </div>
      {status === 'complete' || queries.length === 0 ? null : (
        <ul
          aria-label="検索の進捗"
          className="flex flex-col gap-1.5 font-mono text-muted-foreground"
        >
          {queries.map((query, index) => (
            <li key={`${index.toString()}-${query}`}>検索 “{query}”</li>
          ))}
        </ul>
      )}
      {status === 'interrupted' ? (
        <p role="status">
          {interruptedMessage ??
            '調査を中断しました。資料は保存されていません。'}
        </p>
      ) : null}
      {(status === 'interrupted' || status === 'failed') &&
      error !== undefined ? (
        <p role="alert">{error}</p>
      ) : null}
      {active ? (
        <p className="text-muted-foreground">本文は書き続けられます</p>
      ) : null}
    </div>
  )
}
