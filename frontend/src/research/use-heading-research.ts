import { useCallback, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'

import type { ResearchProgressStatus } from '#components/research-progress'
import { loadLlmSettings } from '#lib/llm-settings'
import { researchFromHeading } from '#research/research-from-heading'
import { ResearchJobInterruptedError } from '#research/research-job'

export type ResearchProgressState = {
  status: ResearchProgressStatus
  queries: string[]
  error?: string
}

export function useHeadingResearch() {
  const [progress, setProgress] = useState<
    Record<string, ResearchProgressState>
  >({})
  const controllers = useRef(new Map<string, AbortController>())

  const patchProgress = useCallback(
    (articleId: string, patch: Partial<ResearchProgressState>) => {
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
    (
      articleId: string,
      doc: Y.Doc,
      headingText: string,
      questionInput: string,
    ) => {
      if (controllers.current.has(articleId)) return
      const controller = new AbortController()
      controllers.current.set(articleId, controller)
      setProgress((current) => ({
        ...current,
        [articleId]: { status: 'running', queries: [] },
      }))

      const settings = loadLlmSettings(() => window.localStorage)
      if (settings.isErr()) {
        if (controllers.current.get(articleId) !== controller) return
        controllers.current.delete(articleId)
        patchProgress(articleId, {
          status: 'failed',
          error: 'LLM 設定を読み込めませんでした。',
        })
        return
      }

      const question = questionInput.trim() || headingText
      void researchFromHeading(
        fetch,
        articleId,
        doc,
        settings.value,
        question,
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
        () => {
          setProgress((current) => {
            if (current[articleId]?.status === 'cancelling') return current
            return {
              ...current,
              [articleId]: {
                ...(current[articleId] ?? { status: 'running', queries: [] }),
                status: 'saving',
              },
            }
          })
        },
      ).match(
        () => {
          if (controllers.current.get(articleId) !== controller) return
          controllers.current.delete(articleId)
          patchProgress(articleId, { status: 'complete' })
        },
        (researchError) => {
          if (controllers.current.get(articleId) !== controller) return
          controllers.current.delete(articleId)
          const interrupted =
            researchError instanceof ResearchJobInterruptedError
          patchProgress(articleId, {
            status: interrupted ? 'interrupted' : 'failed',
            ...(interrupted && controller.signal.aborted
              ? {}
              : { error: researchError.message }),
          })
        },
      )
    },
    [patchProgress],
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

  return { cancelResearch, progress, startResearch }
}
