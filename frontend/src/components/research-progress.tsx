import { Button } from '@fohte/ui/button'

export type ResearchProgressStatus =
  'running' | 'saving' | 'cancelling' | 'complete' | 'interrupted' | 'failed'

export type ResearchProgressStep =
  | { kind: 'search'; query: string }
  | { kind: 'fetching' | 'fetched' | 'unavailable'; url: string }

export type ResearchProgressProps = {
  status: ResearchProgressStatus
  steps: ResearchProgressStep[]
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

const fetchLabels = {
  fetching: '取得中',
  fetched: '取得済み',
  unavailable: '取得できず',
}

export function ResearchProgress({
  status,
  steps,
  target,
  error,
  interruptedMessage,
  onCancel,
}: ResearchProgressProps) {
  const active = status === 'running' || status === 'saving'
  // A stopped job will never finish these fetches, so "fetching" would be false.
  const shownSteps =
    status === 'interrupted' || status === 'failed'
      ? steps.filter((step) => step.kind !== 'fetching')
      : steps
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
      {status === 'complete' || shownSteps.length === 0 ? null : (
        <ul
          aria-label="調査の進捗"
          className="flex flex-col gap-1.5 font-mono text-muted-foreground"
        >
          {shownSteps.map((step, index) =>
            step.kind === 'search' ? (
              <li key={index}>検索 “{step.query}”</li>
            ) : (
              <li className="truncate" key={index} title={step.url}>
                {fetchLabels[step.kind]} {step.url.replace(/^https?:\/\//, '')}
              </li>
            ),
          )}
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
