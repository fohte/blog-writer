import { errAsync, okAsync } from 'neverthrow'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'

import {
  getBody,
  listEvidenceOverlapping,
  removeEvidence,
  setEvidence,
} from '#article/index'
import type { ResearchProgressStatus } from '#components/research-progress'
import type {
  SuggestionDecision,
  TextSuggestion,
  TrackedSuggestionRange,
} from '#editor/suggestion-layer'
import { loadLlmSettings } from '#lib/llm-settings'
import {
  type ClaimEvidenceResult,
  judgeClaimEvidenceFromSources,
} from '#research/claim-evidence'
import {
  claimEvidenceExtension,
  claimEvidenceLayerOverlaps,
  type ClaimEvidenceSuggestionMetadata,
  clearClaimEvidenceInFlight,
  currentClaimEvidenceInFlight,
  setClaimEvidenceInFlight,
  setClaimEvidenceSuggestion,
} from '#research/claim-evidence-layer'
import {
  type SavedResearchSource,
  saveResearchJobResult,
} from '#research/research-from-heading'
import {
  ResearchJobInterruptedError,
  runResearchJob,
} from '#research/research-job'

export type ClaimEvidenceProgressState = {
  status: ResearchProgressStatus
  queries: string[]
  error?: string
}

type ClaimEvidenceTarget = {
  articleId: string
  doc: Y.Doc
  claim: string
  range: { from: number; to: number }
  before?: string
  after?: string
}

function selectedSource(
  result: ClaimEvidenceResult,
  sources: SavedResearchSource[],
) {
  if (result.quote)
    return sources.find(
      ({ researchId }) => researchId === result.quote?.source_id,
    )
  return sources[0]
}

export function useClaimEvidence() {
  const [progress, setProgress] = useState<
    Record<string, ClaimEvidenceProgressState>
  >({})
  const controllers = useRef(new Map<string, AbortController>())

  const patchProgress = useCallback(
    (articleId: string, patch: Partial<ClaimEvidenceProgressState>) => {
      setProgress((current) => ({
        ...current,
        [articleId]: {
          ...(current[articleId] ?? { status: 'running', queries: [] }),
          ...patch,
        },
      }))
    },
    [],
  )

  const resolveSuggestion = useCallback(
    (
      suggestion: TextSuggestion<ClaimEvidenceSuggestionMetadata>,
      decision: SuggestionDecision,
      acceptedRange?: TrackedSuggestionRange,
    ) => {
      if (decision !== 'accept' || !acceptedRange) return
      const { metadata } = suggestion
      if (!metadata) {
        acceptedRange.dispose()
        return
      }
      const range = acceptedRange.current()
      if (!range) {
        acceptedRange.dispose()
        return
      }
      const body = getBody(metadata.doc)
      const adoptedClaim = body.toJSON().slice(range.from, range.to)
      for (const id of metadata.evidenceIds) removeEvidence(metadata.doc, id)
      const adoptedEvidence = setEvidence(metadata.doc, {
        from: range.from,
        to: range.to,
        claim: adoptedClaim,
        sourceId: metadata.sourceId,
        quote: '',
        verdict: 'insufficient',
        checkedAt: metadata.checkedAt,
      })
      if (adoptedEvidence.isErr()) {
        acceptedRange.dispose()
        return
      }

      const settings = loadLlmSettings(() => window.localStorage)
      if (settings.isErr()) {
        acceptedRange.dispose()
        return
      }
      void judgeClaimEvidenceFromSources(
        fetch,
        adoptedClaim,
        metadata.sourceBodies,
        settings.value,
        new AbortController().signal,
        metadata.before,
        metadata.after,
      ).match(
        (result) => {
          const latestRange = acceptedRange.current()
          if (latestRange) {
            const latestClaim = getBody(metadata.doc)
              .toJSON()
              .slice(latestRange.from, latestRange.to)
            const source = selectedSource(result, metadata.sources)
            if (latestClaim === adoptedClaim && source)
              setEvidence(metadata.doc, {
                from: latestRange.from,
                to: latestRange.to,
                claim: latestClaim,
                sourceId: source.id,
                quote: result.quote?.text ?? '',
                verdict: result.verdict,
                checkedAt: new Date().toISOString(),
              }).match(
                () => undefined,
                () => undefined,
              )
          }
          acceptedRange.dispose()
        },
        () => {
          acceptedRange.dispose()
        },
      )
    },
    [],
  )

  const cancelResearch = useCallback(
    (articleId: string) => {
      const controller = controllers.current.get(articleId)
      if (!controller) return
      controller.abort()
      patchProgress(articleId, { status: 'cancelling' })
    },
    [patchProgress],
  )

  const startResearch = useCallback(
    (target: ClaimEvidenceTarget) => {
      const { articleId, doc, claim, range, before, after } = target
      if (controllers.current.has(articleId) || claim.trim().length === 0)
        return
      if (claimEvidenceLayerOverlaps(doc, range, resolveSuggestion)) {
        patchProgress(articleId, {
          status: 'failed',
          queries: [],
          error: 'この範囲には別の提案が表示されています。',
        })
        return
      }

      const controller = new AbortController()
      let isFinishing = false
      const onRangeEdited = () => {
        if (isFinishing) return
        controller.abort()
        patchProgress(articleId, { status: 'cancelling' })
      }
      const inFlightResult = setClaimEvidenceInFlight(
        doc,
        range,
        resolveSuggestion,
        onRangeEdited,
      )
      if (inFlightResult.isErr()) {
        patchProgress(articleId, {
          status: 'failed',
          queries: [],
          error: '対象の範囲に調査を表示できませんでした。',
        })
        return
      }
      controllers.current.set(articleId, controller)
      setProgress((current) => ({
        ...current,
        [articleId]: { status: 'running', queries: [] },
      }))
      const settings = loadLlmSettings(() => window.localStorage)
      if (settings.isErr()) {
        controllers.current.delete(articleId)
        isFinishing = true
        clearClaimEvidenceInFlight(doc, resolveSuggestion, onRangeEdited)
        patchProgress(articleId, {
          status: 'failed',
          error: 'LLM 設定を読み込めませんでした。',
        })
        return
      }

      const job = runResearchJob(
        fetch,
        settings.value,
        {
          task: 'claim_evidence',
          claim,
          ...(before === undefined ? {} : { before }),
          ...(after === undefined ? {} : { after }),
        },
        controller.signal,
        (query) => {
          setProgress((current) => {
            const currentProgress = current[articleId]
            if (currentProgress?.status === 'cancelling') return current
            return {
              ...current,
              [articleId]: {
                ...(currentProgress ?? { status: 'running', queries: [] }),
                status: 'running',
                queries: [...(currentProgress?.queries ?? []), query],
              },
            }
          })
        },
      ).andThen((result) => {
        const analysis = result.analysis
        if (analysis.task !== 'claim_evidence')
          return errAsync(new Error('根拠の判定結果を読み取れませんでした。'))
        const judgment = analysis.data
        const currentRange = currentClaimEvidenceInFlight(
          doc,
          resolveSuggestion,
          onRangeEdited,
        )
        if (!currentRange || controller.signal.aborted)
          return errAsync(
            new ResearchJobInterruptedError('調査を中断しました。'),
          )
        if (result.sources.length === 0)
          return errAsync(new Error('判定に使える資料が見つかりませんでした。'))
        return saveResearchJobResult(
          fetch,
          articleId,
          doc,
          result,
          undefined,
          controller.signal,
          () => {
            patchProgress(articleId, { status: 'saving' })
          },
        ).andThen((sources) => {
          const savedRange = currentClaimEvidenceInFlight(
            doc,
            resolveSuggestion,
            onRangeEdited,
          )
          if (!savedRange || controller.signal.aborted)
            return errAsync(
              new ResearchJobInterruptedError('調査を中断しました。'),
            )
          const currentClaim = getBody(doc)
            .toJSON()
            .slice(savedRange.from, savedRange.to)
          if (currentClaim !== claim)
            return errAsync(
              new ResearchJobInterruptedError('調査を中断しました。'),
            )
          const source = selectedSource(judgment, sources)
          if (!source)
            return errAsync(new Error('判定に使える資料がありません。'))
          const checkedAt = new Date().toISOString()
          const existing = listEvidenceOverlapping(doc, savedRange).filter(
            ({ currentClaim: evidenceClaim }) => evidenceClaim === claim,
          )
          for (const item of existing) removeEvidence(doc, item.id)
          const evidenceResult = setEvidence(doc, {
            from: savedRange.from,
            to: savedRange.to,
            claim,
            sourceId: source.id,
            quote: judgment.quote?.text ?? '',
            verdict: judgment.verdict,
            checkedAt,
          })
          if (evidenceResult.isErr()) return errAsync(evidenceResult.error)

          isFinishing = true
          clearClaimEvidenceInFlight(doc, resolveSuggestion, onRangeEdited)
          const suggestedText = judgment.suggestion?.trim()
          if (
            (judgment.verdict === 'outdated' ||
              judgment.verdict === 'contradicted') &&
            suggestedText !== undefined &&
            suggestedText.length > 0
          ) {
            const metadata: ClaimEvidenceSuggestionMetadata = {
              sourceId: source.id,
              checkedAt,
              ...(before === undefined ? {} : { before }),
              ...(after === undefined ? {} : { after }),
              sourceBodies: sources.flatMap((saved) =>
                saved.body === undefined
                  ? []
                  : [{ id: saved.id, body: saved.body }],
              ),
              sources,
              evidenceIds: listEvidenceOverlapping(doc, savedRange).map(
                ({ id }) => id,
              ),
              doc,
            }
            const suggestionResult = setClaimEvidenceSuggestion(
              doc,
              {
                id: crypto.randomUUID(),
                from: savedRange.from,
                to: savedRange.to,
                replacement: suggestedText,
                note: `根拠の資料: ${source.title}`,
                metadata,
              },
              resolveSuggestion,
            )
            if (suggestionResult.isErr())
              return errAsync(new Error('修正案を本文に表示できませんでした。'))
          }
          return okAsync(undefined)
        })
      })

      void job.match(
        () => {
          if (controllers.current.get(articleId) !== controller) return
          controllers.current.delete(articleId)
          isFinishing = true
          clearClaimEvidenceInFlight(doc, resolveSuggestion, onRangeEdited)
          patchProgress(articleId, { status: 'complete' })
        },
        (error) => {
          if (controllers.current.get(articleId) !== controller) return
          controllers.current.delete(articleId)
          isFinishing = true
          clearClaimEvidenceInFlight(doc, resolveSuggestion, onRangeEdited)
          const interrupted =
            error instanceof ResearchJobInterruptedError ||
            controller.signal.aborted
          patchProgress(articleId, {
            status: interrupted ? 'interrupted' : 'failed',
            ...(interrupted && controller.signal.aborted
              ? {}
              : { error: error.message }),
          })
        },
      )
    },
    [patchProgress, resolveSuggestion],
  )

  useEffect(() => {
    const activeArticleId = Object.entries(progress).find(
      ([, state]) => state.status === 'running' || state.status === 'saving',
    )?.[0]
    if (activeArticleId === undefined) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelResearch(activeArticleId)
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [cancelResearch, progress])

  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort()
      controllers.current.clear()
    },
    [],
  )

  return {
    cancelResearch,
    editorExtension: (doc: Y.Doc) =>
      claimEvidenceExtension(doc, resolveSuggestion),
    progress,
    startResearch,
  }
}
