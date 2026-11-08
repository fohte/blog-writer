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
import { ArticlePremisePanel } from '#components/article-premise-panel'
import type { PremiseConversationMessage } from '#components/premise-panel-view'
import { loadLlmSettings } from '#lib/llm-settings'
import { requestPremiseProposal } from '#proposals/premise-api'

const premiseFields: PremiseField[] = ['audience', 'purpose', 'claim']

const apiFields: Record<PremiseField, 'audience' | 'purpose' | 'thesis'> = {
  audience: 'audience',
  purpose: 'purpose',
  claim: 'thesis',
}

type ActiveRequest = {
  controller: AbortController
  invalidatedFields: Set<PremiseField>
}

function flattenHeadings(
  headings: ReturnType<typeof deriveHeadingTree>,
): string[] {
  return headings.flatMap(({ level, text, children }) => [
    `${'#'.repeat(level)} ${text}`,
    ...flattenHeadings(children),
  ])
}

export interface PremiseDiscussionPanelProps {
  doc: Y.Doc
}

export function PremiseDiscussionPanel({ doc }: PremiseDiscussionPanelProps) {
  const [premise, setPremiseState] = useState(() => getPremise(doc))
  const [messages, setMessages] = useState<PremiseConversationMessage[]>([])
  const [proposals, setProposals] = useState<
    Partial<Record<PremiseField, string>>
  >({})
  const [draft, setDraft] = useState('')
  const [generating, setGenerating] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [cancelled, setCancelled] = useState(false)
  const [error, setError] = useState<string>()
  const premiseRef = useRef(premise)
  const activeRequest = useRef<ActiveRequest | null>(null)

  useEffect(() => {
    const premiseMap = doc.getMap('premise')
    const refresh = () => {
      const nextPremise = getPremise(doc)
      const changedFields = premiseFields.filter(
        (field) => premiseRef.current[field] !== nextPremise[field],
      )
      premiseRef.current = nextPremise
      setPremiseState(nextPremise)
      if (changedFields.length === 0) return

      changedFields.forEach((field) => {
        activeRequest.current?.invalidatedFields.add(field)
      })
      setProposals((current) =>
        Object.fromEntries(
          premiseFields.flatMap((field) => {
            const proposal = current[field]
            return changedFields.includes(field) || proposal === undefined
              ? []
              : [[field, proposal]]
          }),
        ),
      )
    }
    premiseMap.observe(refresh)
    refresh()
    return () => {
      premiseMap.unobserve(refresh)
    }
  }, [doc])

  useEffect(
    () => () => {
      activeRequest.current?.controller.abort()
      activeRequest.current = null
    },
    [],
  )

  useEffect(() => {
    if (!generating) return
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [generating])

  const visibleProposals = useMemo(
    () =>
      Object.fromEntries(
        premiseFields.flatMap((field) => {
          const replacement = proposals[field]
          return replacement === undefined ||
            replacement === (premise[field] ?? '')
            ? []
            : [[field, replacement]]
        }),
      ),
    [premise, proposals],
  )

  const sendMessage = () => {
    const content = draft.trim()
    if (!content || generating) return

    activeRequest.current?.controller.abort()
    const controller = new AbortController()
    const requestContext: ActiveRequest = {
      controller,
      invalidatedFields: new Set(),
    }
    activeRequest.current = requestContext
    const nextMessages: PremiseConversationMessage[] = [
      ...messages,
      { role: 'user', content },
    ]
    const currentPremise = getPremise(doc)
    premiseRef.current = currentPremise
    setPremiseState(currentPremise)
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
    setCancelled(false)
    const requestStartedAt = Date.now()
    setStartedAt(requestStartedAt)
    setNow(requestStartedAt)
    setGenerating(true)
    const result = loadLlmSettings(() => window.localStorage).match(
      (settings) =>
        requestPremiseProposal(fetch, settings, request, controller.signal),
      (cause) => errAsync(cause),
    )
    void result.match(
      (response) => {
        if (activeRequest.current !== requestContext) return
        activeRequest.current = null
        const latestPremise = getPremise(doc)
        const values: Partial<Record<PremiseField, string>> = {}
        for (const field of premiseFields) {
          const replacement = response[apiFields[field]]
          if (
            !requestContext.invalidatedFields.has(field) &&
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
        if (activeRequest.current !== requestContext) return
        activeRequest.current = null
        setGenerating(false)
        if (!controller.signal.aborted) setError(cause.message)
      },
    )
  }

  const cancelRequest = () => {
    if (!activeRequest.current) return
    activeRequest.current.controller.abort()
    activeRequest.current = null
    setGenerating(false)
    setCancelled(true)
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
    <ArticlePremisePanel
      discussion={{
        cancelled,
        draft,
        elapsedSeconds: Math.floor((now - startedAt) / 1000),
        error,
        generating,
        messages,
        onAccept: acceptProposal,
        onCancel: cancelRequest,
        onDraftChange: setDraft,
        onReject: rejectProposal,
        onSubmit: sendMessage,
        proposals: visibleProposals,
      }}
      doc={doc}
    />
  )
}
