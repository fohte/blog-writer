import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from 'neverthrow'
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
import { deleteSourceBody, saveSourceBody } from '#lib/source-api'
import {
  ResearchJobInterruptedError,
  runResearchJob,
} from '#research/research-job'
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

class ResearchBodyRollbackError extends Error {
  constructor(cause: Error) {
    super(
      '調査結果を保存できませんでした。保存済みの資料本文が残っている可能性があります。',
      { cause },
    )
    this.name = 'ResearchBodyRollbackError'
  }
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
  const analysisSources =
    result.analysis.task === 'key_points' ? result.analysis.data.sources : []
  const analyses = new Map(
    analysisSources.map((analysis) => [analysis.id, analysis]),
  )

  return result.sources.flatMap((source) => {
    const url = sourceUrl(source)
    if (seenUrls.has(url)) return []
    seenUrls.add(url)
    const existing = existingByUrl.get(url)
    const id = existing?.id ?? source.id
    const providedTitle = source.title?.trim()
    const title =
      providedTitle !== undefined && providedTitle.length > 0
        ? providedTitle
        : (getSourceHost(url) ?? url)
    const analysis = analyses.get(source.id)
    return [
      {
        source,
        id,
        url,
        title,
        ...(existing === undefined ? {} : { existing }),
        ...(analysis === undefined ? {} : { analysis }),
        saveBody:
          (existing === undefined || existing.status === 'unavailable') &&
          source.status === 'available' &&
          typeof source.body === 'string',
      },
    ]
  })
}

function rollbackSourceBodies(
  fetcher: typeof fetch,
  articleId: string,
  sourceIds: string[],
): ResultAsync<void, Error> {
  return ResultAsync.fromPromise(
    Promise.all(
      sourceIds.map((sourceId) =>
        deleteSourceBody(fetcher, articleId, sourceId).match(
          () => undefined,
          (error) => error,
        ),
      ),
    ),
    (cause) =>
      new ResearchBodyRollbackError(
        cause instanceof Error
          ? cause
          : new Error('資料本文を削除できませんでした。'),
      ),
  ).andThen((errors) => {
    const firstError = errors.find((error) => error !== undefined)
    return firstError === undefined
      ? okAsync(undefined)
      : errAsync(new ResearchBodyRollbackError(firstError))
  })
}

function saveBodies(
  fetcher: typeof fetch,
  articleId: string,
  plans: SourcePlan[],
  signal: AbortSignal,
): ResultAsync<string[], Error> {
  const attemptedSourceIds: string[] = []
  const saveNext = (
    index: number,
    savedSourceIds: string[],
  ): ResultAsync<string[], Error> => {
    const plan = plans[index]
    if (plan === undefined) return okAsync(savedSourceIds)
    if (
      !plan.saveBody ||
      plan.source.body === undefined ||
      plan.source.body === null
    )
      return saveNext(index + 1, savedSourceIds)

    attemptedSourceIds.push(plan.id)
    return saveSourceBody(
      fetcher,
      articleId,
      plan.id,
      plan.source.body,
      signal,
    ).andThen(() => saveNext(index + 1, [...savedSourceIds, plan.id]))
  }

  return saveNext(0, []).orElse((saveError) =>
    rollbackSourceBodies(fetcher, articleId, attemptedSourceIds).andThen(() =>
      errAsync(
        signal.aborted
          ? new ResearchJobInterruptedError('調査を中断しました。', saveError)
          : saveError,
      ),
    ),
  )
}

function validateSourceChanges(
  doc: Y.Doc,
  plans: SourcePlan[],
): Error | undefined {
  const currentById = new Map(
    listSources(doc).map((source) => [source.id, source]),
  )
  const plannedIds = new Set<string>()

  for (const plan of plans) {
    if (plan.id.trim().length === 0 || plan.title.trim().length === 0)
      return new Error('調査結果に有効な資料 ID またはタイトルがありません。')
    if (plannedIds.has(plan.id))
      return new Error('調査結果に重複した資料 ID があります。')
    plannedIds.add(plan.id)

    const current = currentById.get(plan.id)
    if (plan.existing !== undefined) {
      if (current?.url !== plan.url)
        return new Error(
          '調査中に資料が変更されたため、結果を保存できませんでした。',
        )
    } else if (current !== undefined) {
      return new Error('調査結果の資料 ID が既存の資料と重複しています。')
    }
  }

  return undefined
}

function saveResultInDocument(
  doc: Y.Doc,
  plans: SourcePlan[],
): Result<void, Error> {
  const checkedAt = new Date().toISOString()
  return doc.transact(() => {
    for (const plan of plans) {
      const isAvailable =
        plan.source.status === 'available' &&
        (plan.saveBody ||
          (plan.existing !== undefined &&
            plan.existing.status !== 'unavailable'))
      const summary = plan.analysis?.summary ?? plan.existing?.summary ?? ''
      const sourceResult = plan.existing
        ? updateSource(doc, plan.id, {
            summary,
            ...(isAvailable ? { status: 'ready' as const, checkedAt } : {}),
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
        return err(sourceResult.error)
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
        return err(findingsResult.error)
      }
    }
    return ok(undefined)
  })
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
    const plans = planSources(doc, result)
    const validationError = validateSourceChanges(doc, plans)
    if (validationError) return errAsync(validationError)
    onSaving()
    return saveBodies(fetcher, articleId, plans, signal).andThen(
      (savedSourceIds) => {
        if (signal.aborted)
          return rollbackSourceBodies(
            fetcher,
            articleId,
            savedSourceIds,
          ).andThen(() =>
            errAsync(new ResearchJobInterruptedError('調査を中断しました。')),
          )
        const error = validateSourceChanges(doc, plans)
        if (error)
          return rollbackSourceBodies(
            fetcher,
            articleId,
            savedSourceIds,
          ).andThen(() => errAsync(error))
        const saveResult = saveResultInDocument(doc, plans)
        if (saveResult.isErr())
          return rollbackSourceBodies(
            fetcher,
            articleId,
            savedSourceIds,
          ).andThen(() => err(saveResult.error))
        return ok(undefined)
      },
    )
  })
}
