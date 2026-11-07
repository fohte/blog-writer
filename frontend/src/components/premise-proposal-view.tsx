import { Button } from '@fohte/ui/button'
import { Textarea } from '@fohte/ui/textarea'

import type { PremiseField } from '#article/types'
import { SuggestionDiff } from '#components/suggestion-diff'

export type PremiseConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type PremiseFieldProposal = {
  field: PremiseField
  label: string
  original: string
  replacement: string
}

export interface PremiseProposalViewProps {
  messages: readonly PremiseConversationMessage[]
  proposals: readonly PremiseFieldProposal[]
  draft: string
  generating?: boolean
  error?: string | undefined
  onDraftChange: (value: string) => void
  onSubmit: () => void
  onAccept: (field: PremiseField) => void
  onReject: (field: PremiseField) => void
}

export function PremiseProposalView({
  messages,
  proposals,
  draft,
  generating = false,
  error,
  onDraftChange,
  onSubmit,
  onAccept,
  onReject,
}: PremiseProposalViewProps) {
  return (
    <section
      aria-label="Premise conversation"
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      {messages.length > 0 ? (
        <ol aria-label="Conversation history" className="flex flex-col gap-3">
          {messages.map(({ role, content }, index) => (
            <li
              className="flex flex-col gap-1 text-sm"
              key={`${role}-${String(index)}`}
            >
              <span className="font-medium">
                {role === 'assistant' ? 'Assistant' : 'You'}
              </span>
              <p className="whitespace-pre-wrap">{content}</p>
            </li>
          ))}
        </ol>
      ) : null}
      {proposals.map(({ field, label, original, replacement }) => (
        <section
          aria-label={`${label} suggestion`}
          className="flex flex-col gap-2"
          key={field}
        >
          <h3 className="text-sm font-medium">{label}</h3>
          <SuggestionDiff
            onAccept={() => {
              onAccept(field)
            }}
            onReject={() => {
              onReject(field)
            }}
            original={original}
            replacement={replacement}
            focused
          />
        </section>
      ))}
      {generating ? (
        <p aria-live="polite" role="status">
          Thinking…
        </p>
      ) : null}
      {error !== undefined ? <p role="alert">{error}</p> : null}
      <label
        className="flex flex-col gap-2 text-sm font-medium"
        htmlFor="premise-message"
      >
        Continue the discussion
        <Textarea
          disabled={generating}
          id="premise-message"
          onChange={(event) => {
            onDraftChange(event.currentTarget.value)
          }}
          value={draft}
        />
      </label>
      <div>
        <Button
          disabled={generating || draft.trim().length === 0}
          onClick={() => {
            onSubmit()
          }}
          type="button"
        >
          Send
        </Button>
      </div>
    </section>
  )
}
