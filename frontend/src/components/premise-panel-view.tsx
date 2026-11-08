import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { Textarea } from '@fohte/ui/textarea'

import type { PremiseField } from '#article/types'
import { SuggestionDiff } from '#components/suggestion-diff'
import { SuggestionGeneratingBar } from '#components/suggestion-generating-bar'

export type PremiseConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type PremiseDiscussion = {
  messages: readonly PremiseConversationMessage[]
  proposals: Partial<Record<PremiseField, string>>
  draft: string
  generating: boolean
  elapsedSeconds: number
  cancelled: boolean
  error: string | undefined
  onDraftChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  onAccept: (field: PremiseField) => void
  onReject: (field: PremiseField) => void
}

export interface PremisePanelViewProps {
  values: Record<PremiseField, string>
  onValueChange: (field: PremiseField, value: string) => void
  discussion?: PremiseDiscussion | undefined
}

const premiseFields: Array<{ field: PremiseField; label: string }> = [
  { field: 'audience', label: '想定読者' },
  { field: 'purpose', label: '目的' },
  { field: 'claim', label: '主張' },
]

export function PremisePanelView({
  values,
  onValueChange,
  discussion,
}: PremisePanelViewProps) {
  const replied =
    discussion?.messages.some(({ role }) => role === 'assistant') ?? false

  return (
    <div className="flex flex-col gap-4">
      {premiseFields.map(({ field, label }) => {
        const proposal = discussion?.proposals[field]
        return (
          <div className="flex flex-col gap-1.5" key={field}>
            <label
              className="text-xs font-bold text-muted-foreground"
              htmlFor={`premise-${field}`}
            >
              {label}
            </label>
            <Textarea
              id={`premise-${field}`}
              onChange={(event) => {
                onValueChange(field, event.currentTarget.value)
              }}
              placeholder="まだ空です"
              value={values[field]}
            />
            {discussion && proposal !== undefined ? (
              <div
                aria-label={`${label}の修正案`}
                className="flex flex-col gap-2 border border-dashed border-tint-green-foreground p-2.5 text-sm leading-relaxed"
                role="group"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {values[field].length === 0 ? '修正案 (新規)' : '修正案'}
                </span>
                <SuggestionDiff
                  original={values[field]}
                  replacement={proposal}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => {
                      discussion.onReject(field)
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    却下
                  </Button>
                  <Button
                    onClick={() => {
                      discussion.onAccept(field)
                    }}
                    size="sm"
                    type="button"
                    variant="solid"
                  >
                    採用
                  </Button>
                </div>
              </div>
            ) : replied ? (
              <span className="text-xs text-muted-foreground">修正案なし</span>
            ) : null}
          </div>
        )
      })}

      {discussion ? (
        <section
          aria-label="前提の対話"
          className="flex flex-col gap-3.5 border-t border-border pt-3.5 text-sm leading-relaxed"
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !discussion.generating) return
            event.preventDefault()
            discussion.onCancel()
          }}
        >
          <p className="text-xs text-muted-foreground">
            このやり取りは保存されません。残るのは採用した値だけです。
          </p>
          {discussion.messages.length > 0 ? (
            <ol aria-label="やり取り" className="flex flex-col gap-3.5">
              {discussion.messages.map(({ role, content }, index) => (
                <li
                  className="flex flex-col gap-0.5"
                  key={`${role}-${String(index)}`}
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {role === 'assistant' ? 'LLM' : 'あなた'}
                  </span>
                  <p className="whitespace-pre-wrap">{content}</p>
                </li>
              ))}
            </ol>
          ) : null}
          {discussion.generating ? (
            <SuggestionGeneratingBar
              elapsedSeconds={discussion.elapsedSeconds}
              onCancel={discussion.onCancel}
            />
          ) : discussion.cancelled ? (
            <p
              aria-live="polite"
              className="text-xs text-muted-foreground"
              role="status"
            >
              中止しました
            </p>
          ) : null}
          {discussion.error === undefined ? null : (
            <p className="text-xs text-destructive" role="alert">
              {discussion.error}
            </p>
          )}
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (discussion.draft.trim().length === 0) return
              // The send button is disabled while generating, so keep focus where Esc can cancel.
              event.currentTarget
                .querySelector<HTMLInputElement>('#premise-message')
                ?.focus()
              discussion.onSubmit()
            }}
          >
            <label className="sr-only" htmlFor="premise-message">
              前提について話す
            </label>
            <div className="flex flex-1 items-center gap-2 border border-border-strong pl-2.5 focus-within:border-ring dark:bg-input/30">
              <span
                aria-hidden="true"
                className="font-mono font-bold text-primary"
              >
                &gt;
              </span>
              <Input
                className="border-0 bg-transparent px-0 focus-visible:ring-0 dark:bg-transparent"
                id="premise-message"
                onChange={(event) => {
                  discussion.onDraftChange(event.currentTarget.value)
                }}
                placeholder="前提について話す"
                // Read-only rather than disabled keeps focus in the field so Esc reaches the cancel handler.
                readOnly={discussion.generating}
                value={discussion.draft}
              />
            </div>
            <Button
              disabled={
                discussion.generating || discussion.draft.trim().length === 0
              }
              size="sm"
              type="submit"
              variant="outline"
            >
              送る
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  )
}
