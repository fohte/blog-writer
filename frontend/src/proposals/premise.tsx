import { errAsync } from 'neverthrow'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'

import {
  deriveHeadingTree,
  getBody,
  getPremise,
  setPremise,
} from '#article/index'
import type { PremiseField } from '#article/types'
import {
  type PremiseConversationMessage,
  type PremiseFieldProposal,
  PremiseProposalView,
} from '#components/premise-proposal-view'
import { loadLlmSettings } from '#lib/llm-settings'
import { requestPremiseProposal } from '#proposals/premise-api'

const fieldLabels: Record<PremiseField, string> = {
  audience: 'Reader',
  purpose: 'Purpose',
  claim: 'Claim',
}

const premiseFields: PremiseField[] = ['audience', 'purpose', 'claim']

const apiFields: Record<PremiseField, 'audience' | 'purpose' | 'thesis'> = {
  audience: 'audience',
  purpose: 'purpose',
  claim: 'thesis',
}

function flattenHeadings(
  headings: ReturnType<typeof deriveHeadingTree>,
): string[] {
  return headings.flatMap(({ text, children }) => [
    text,
    ...flattenHeadings(children),
  ])
}

export interface PremiseProposalAccessoryProps {
  doc: Y.Doc
}

export function PremiseProposalAccessory({
  doc,
}: PremiseProposalAccessoryProps) {
  const [premise, setPremiseState] = useState(() => getPremise(doc))
  const [messages, setMessages] = useState<PremiseConversationMessage[]>([])
  const [proposals, setProposals] = useState<
    Partial<Record<PremiseField, string>>
  >({})
  const [draft, setDraft] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string>()
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    const premiseMap = doc.getMap('premise')
    const refresh = () => {
      setPremiseState(getPremise(doc))
    }
    premiseMap.observe(refresh)
    refresh()
    return () => {
      premiseMap.unobserve(refresh)
    }
  }, [doc])

  useEffect(
    () => () => {
      activeRequest.current?.abort()
      activeRequest.current = null
    },
    [],
  )

  const proposalViews = useMemo<PremiseFieldProposal[]>(
    () =>
      premiseFields.flatMap((field) => {
        const replacement = proposals[field]
        const original = premise[field] ?? ''
        if (replacement === undefined || replacement === original) return []
        return [
          {
            field,
            label: fieldLabels[field],
            original,
            replacement,
          },
        ]
      }),
    [premise, proposals],
  )

  const sendMessage = () => {
    const content = draft.trim()
    if (!content || generating) return

    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    const nextMessages: PremiseConversationMessage[] = [
      ...messages,
      { role: 'user', content },
    ]
    const currentPremise = getPremise(doc)
    const body = getBody(doc).toJSON()
    const request = {
      premise: {
        audience: currentPremise.audience ?? '',
        purpose: currentPremise.purpose ?? '',
        thesis: currentPremise.claim ?? '',
      },
      headings: flattenHeadings(deriveHeadingTree(body)),
      messages: nextMessages,
    }

    setError(undefined)
    setGenerating(true)
    setProposals({})
    const result = loadLlmSettings(() => window.localStorage).match(
      (settings) =>
        requestPremiseProposal(fetch, settings, request, controller.signal),
      (cause) => errAsync(cause),
    )
    void result.match(
      (response) => {
        if (activeRequest.current !== controller) return
        activeRequest.current = null
        const latestPremise = getPremise(doc)
        const values: Partial<Record<PremiseField, string>> = {}
        for (const field of premiseFields) {
          const replacement = response[apiFields[field]]
          if (
            replacement !== undefined &&
            replacement !== (latestPremise[field] ?? '')
          ) {
            values[field] = replacement
          }
        }
        setPremiseState(latestPremise)
        setProposals(values)
        setMessages([
          ...nextMessages,
          { role: 'assistant', content: response.reply },
        ])
        setDraft('')
        setGenerating(false)
      },
      (cause) => {
        if (activeRequest.current !== controller) return
        activeRequest.current = null
        setGenerating(false)
        if (!controller.signal.aborted) setError(cause.message)
      },
    )
  }

  const acceptProposal = (field: PremiseField) => {
    const replacement = proposals[field]
    if (replacement === undefined) return
    setPremise(doc, field, replacement.length > 0 ? replacement : null)
    setPremiseState(getPremise(doc))
    setProposals((current) => {
      return { ...current, [field]: undefined }
    })
  }

  const rejectProposal = (field: PremiseField) => {
    setProposals((current) => {
      return { ...current, [field]: undefined }
    })
  }

  return (
    <PremiseProposalView
      draft={draft}
      error={error}
      generating={generating}
      messages={messages}
      onAccept={acceptProposal}
      onDraftChange={setDraft}
      onReject={rejectProposal}
      onSubmit={sendMessage}
      proposals={proposalViews}
    />
  )
}
