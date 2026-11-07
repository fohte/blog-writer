import { err, errAsync, ok, okAsync, type ResultAsync } from 'neverthrow'
import * as Y from 'yjs'

import {
  addSource,
  listFindings,
  listSources,
  setFindings,
  type Source,
  updateSource,
} from '#article/index'
import type { components } from '#lib/api/schema.gen.d.ts'
import type { LlmSettings } from '#lib/llm-settings'
import { saveSourceBody } from '#lib/source-api'
import { runResearchJob } from '#research/research-job'
import { getSourceHost } from '#research/source-format'

type ResearchJobSource = components['schemas']['ResearchJobSource']
type ResearchKeyPoints =
  components['schemas']['ResearchKeyPointsResult']['sources'][number]
type ResearchJobResult = components['schemas']['ResearchJobResult']

type SourcePlan = {
  source: ResearchJobSource
  id: string
  url: string
  title: string
  existing?: Source
  analysis?: ResearchKeyPoints
  saveBody: boolean
}

function sourceUrl(source: ResearchJobSource): string {
  return source.final_url ?? source.url
}

function planSources(doc: Y.Doc, result: ResearchJobResult): SourcePlan[] {
  const existingSources = listSources(doc)
  const seenUrls = new Set<string>()
  const existingByUrl = new Map(
    existingSources.flatMap((source) =>
      source.url === null ? [] : [[source.url, source] as const],
    ),
  )
  const plannedByUrl = new Map<string, Source>()
  const analysisSources =
    result.analysis.task === 'key_points' ? result.analysis.data.sources : []
  const analyses = new Map(
    analysisSources.map((analysis) => [analysis.id, analysis]),
  )

  return result.sources.flatMap((source) => {
    const url = sourceUrl(source)
    if (seenUrls.has(url)) return []
    seenUrls.add(url)
    const existing = existingByUrl.get(url) ?? plannedByUrl.get(url)
    const id = existing?.id ?? source.id
    const providedTitle = source.title?.trim()
    const title =
      providedTitle !== undefined && providedTitle.length > 0
        ? providedTitle
        : (getSourceHost(url) ?? url)
    if (!existing) {
      plannedByUrl.set(url, {
        id,
        kind: 'url',
        title,
        url,
        fileName: null,
        checkedAt: null,
        status: 'unavailable',
        summary: '',
      })
    }
    const matchingExisting = existingSources.find(
      ({ id: sourceId }) => sourceId === id,
    )
    const analysis = analyses.get(source.id)
    return [
      {
        source,
        id,
        url,
        title,
        ...(matchingExisting === undefined
          ? {}
          : { existing: matchingExisting }),
        ...(analysis === undefined ? {} : { analysis }),
        saveBody:
          existing === undefined &&
          source.status === 'available' &&
          typeof source.body === 'string',
      },
    ]
  })
}

function saveBodies(
  fetcher: typeof fetch,
  articleId: string,
  plans: SourcePlan[],
  signal: AbortSignal,
  index = 0,
): ResultAsync<void, Error> {
  const plan = plans[index]
  if (plan === undefined) return okAsync(undefined)
  if (
    !plan.saveBody ||
    plan.source.body === undefined ||
    plan.source.body === null
  )
    return saveBodies(fetcher, articleId, plans, signal, index + 1)

  return saveSourceBody(
    fetcher,
    articleId,
    plan.id,
    plan.source.body,
    signal,
  ).andThen(() => saveBodies(fetcher, articleId, plans, signal, index + 1))
}

function saveResultInDocument(
  doc: Y.Doc,
  plans: SourcePlan[],
): Error | undefined {
  let saveError: Error | undefined
  const checkedAt = new Date().toISOString()
  doc.transact(() => {
    for (const plan of plans) {
      const isAvailable =
        plan.source.status === 'available' &&
        (plan.saveBody || plan.existing !== undefined)
      const summary = plan.analysis?.summary ?? plan.existing?.summary ?? ''
      const sourceResult = plan.existing
        ? updateSource(doc, plan.id, {
            ...(isAvailable
              ? { status: 'ready' as const, checkedAt, summary }
              : {}),
          })
        : addSource(doc, {
            id: plan.id,
            kind: 'url',
            title: plan.title,
            url: plan.url,
            fileName: null,
            checkedAt: isAvailable ? checkedAt : null,
            status: isAvailable ? 'ready' : 'unavailable',
            summary,
          })
      if (sourceResult.isErr()) {
        saveError = sourceResult.error
        return
      }
      if (!plan.analysis || plan.analysis.key_points.length === 0) continue
      const existingFindings = listFindings(doc, plan.id)
      const nextFindings = [
        ...existingFindings,
        ...plan.analysis.key_points.map(({ text, quote }) => ({
          id: crypto.randomUUID(),
          text,
          quote,
        })),
      ]
      const findingsResult = setFindings(doc, plan.id, nextFindings)
      if (findingsResult.isErr()) {
        saveError = findingsResult.error
        return
      }
    }
  })
  return saveError
}

export function researchFromHeading(
  fetcher: typeof fetch,
  articleId: string,
  doc: Y.Doc,
  settings: LlmSettings,
  question: string,
  signal: AbortSignal,
  onProgress: (query: string) => void,
  onSaving: () => void,
): ResultAsync<void, Error> {
  return runResearchJob(
    fetcher,
    settings,
    question,
    signal,
    onProgress,
  ).andThen((result) => {
    if (signal.aborted) return errAsync(new Error('調査を中断しました。'))
    const plans = planSources(doc, result)
    onSaving()
    return saveBodies(fetcher, articleId, plans, signal).andThen(() => {
      if (signal.aborted) return errAsync(new Error('調査を中断しました。'))
      const error = saveResultInDocument(doc, plans)
      return error ? err(error) : ok(undefined)
    })
  })
}
