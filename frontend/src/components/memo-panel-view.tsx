import { Button } from '@fohte/ui/button'
import { List } from '@fohte/ui/list'
import { Panel } from '@fohte/ui/panel'
import { Textarea } from '@fohte/ui/textarea'

import type { Memo } from '#article/index'

type MemoPanelViewProps = {
  memos: Memo[]
  draft: string
  error?: string | undefined
  onDraftChange: (draft: string) => void
  onAddMemo: () => void
  onMoveMemo: (id: string, direction: 'up' | 'down') => void
  onDismissMemo: (id: string) => void
  onRestoreMemo: (id: string) => void
}

function getMemoStateLabel(memo: Memo): string {
  switch (memo.state.kind) {
    case 'unorganized':
      return '未整理'
    case 'dismissed':
      return '見送り'
    case 'adopted':
      return `採用済み: ${memo.state.heading.text}`
  }
}

export function MemoPanelView({
  memos,
  draft,
  error,
  onDraftChange,
  onAddMemo,
  onMoveMemo,
  onDismissMemo,
  onRestoreMemo,
}: MemoPanelViewProps) {
  return (
    <section
      aria-labelledby="memo-panel-heading"
      className="flex flex-col gap-4"
    >
      <h2 className="text-xl font-semibold" id="memo-panel-heading">
        メモ
      </h2>

      <Panel className="flex flex-col gap-4 rounded-lg p-4">
        <form
          className="flex flex-col items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            onAddMemo()
          }}
        >
          <label className="font-medium" htmlFor="new-memo">
            新しいメモ
          </label>
          <Textarea
            id="new-memo"
            onChange={(event) => {
              onDraftChange(event.currentTarget.value)
            }}
            placeholder="思いついたことを書き留める"
            value={draft}
          />
          <Button disabled={draft.trim().length === 0} type="submit">
            追加
          </Button>
        </form>

        {error === undefined ? null : <p role="alert">{error}</p>}

        {memos.length === 0 ? (
          <p className="text-muted-foreground">メモはありません。</p>
        ) : (
          <List aria-label="メモ一覧">
            {memos.map((memo, index) => (
              <div
                className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0"
                key={memo.id}
                role="listitem"
              >
                <div className="flex flex-col gap-2">
                  <p className="whitespace-pre-wrap">{memo.text}</p>
                  <p className="text-sm text-muted-foreground">
                    {getMemoStateLabel(memo)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    aria-label={`メモ「${memo.text}」を上へ`}
                    disabled={index === 0}
                    onClick={() => {
                      onMoveMemo(memo.id, 'up')
                    }}
                    type="button"
                    variant="outline"
                  >
                    上へ
                  </Button>
                  <Button
                    aria-label={`メモ「${memo.text}」を下へ`}
                    disabled={index === memos.length - 1}
                    onClick={() => {
                      onMoveMemo(memo.id, 'down')
                    }}
                    type="button"
                    variant="outline"
                  >
                    下へ
                  </Button>
                  {memo.state.kind !== 'dismissed' ? (
                    <Button
                      onClick={() => {
                        onDismissMemo(memo.id)
                      }}
                      type="button"
                      variant="outline"
                    >
                      見送る
                    </Button>
                  ) : null}
                  {memo.state.kind !== 'unorganized' ? (
                    <Button
                      onClick={() => {
                        onRestoreMemo(memo.id)
                      }}
                      type="button"
                      variant="outline"
                    >
                      未整理に戻す
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </List>
        )}
      </Panel>
    </section>
  )
}
