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
  isUnfetchedSource,
  listFindings,
  listSources,
  setFindings,
  type Source,
  updateSource,
} from '#article/index'
import type { components } from '#lib/api/schema.gen.d.ts'
import type { LlmSettings } from '#lib/llm-settings'
import {
  getOptionalSourceBody,
  restoreSourceBody,
  saveSourceBodyIfUnchanged,
  SourceBodyConflictError,
} from '#lib/source-api'
import {
  ResearchJobInterruptedError,
  type ResearchJobProgress,
  runResearchJob,
} from '#research/research-job'
import {
  captureSavedResearchSources,
  restoreResearchSources,
  snapshotResearchSources,
} from '#research/research-source-rollback'
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

type SourceBodySnapshot = { sourceId: string; body?: string }
type SourceBodyRollback = SourceBodySnapshot & { expectedBody: string }

export type SavedResearchSource = {
  id: string
  researchId: string
  title: string
  url: string
  status: ResearchJobSource['status']
  body?: string
}

export type SavedResearchJobResult = {
  sources: SavedResearchSource[]
  rollback: () => ResultAsync<string[], Error>
}

class ResearchBodyRollbackError extends Error {
  constructor(cause: Error) {
    super(
      cause instanceof SourceBodyConflictError
        ? cause.message
        : '調査結果を保存できませんでした。保存済みの資料本文が残っている可能性があります。',
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
          (existing === undefined || isUnfetchedSource(existing)) &&
          source.status === 'available' &&
          typeof source.body === 'string',
      },
    ]
  })
}

function rollbackSourceBodies(
  fetcher: typeof fetch,
  articleId: string,
  snapshots: SourceBodyRollback[],
): ResultAsync<void, Error> {
  return ResultAsync.fromPromise(
    Promise.all(
      snapshots.map(({ body, expectedBody, sourceId }) =>
        restoreSourceBody(
          fetcher,
          articleId,
          sourceId,
          expectedBody,
          body,
        ).match(
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

function snapshotSourceBodies(
  fetcher: typeof fetch,
  articleId: string,
  plans: SourcePlan[],
  signal: AbortSignal,
): ResultAsync<SourceBodySnapshot[], Error> {
  const plansToSave = plans.filter(({ saveBody }) => saveBody)
  const readNext = (
    index: number,
    snapshots: SourceBodySnapshot[],
  ): ResultAsync<SourceBodySnapshot[], Error> => {
    const plan = plansToSave[index]
    if (plan === undefined) return okAsync(snapshots)
    return getOptionalSourceBody(fetcher, articleId, plan.id, signal).andThen(
      (stored) =>
        readNext(index + 1, [
          ...snapshots,
          {
            sourceId: plan.id,
            ...(stored === undefined ? {} : { body: stored.body }),
          },
        ]),
    )
  }
  return readNext(0, [])
}

function saveBodies(
  fetcher: typeof fetch,
  articleId: string,
  plans: SourcePlan[],
  signal: AbortSignal,
): ResultAsync<SourceBodyRollback[], Error> {
  return snapshotSourceBodies(fetcher, articleId, plans, signal)
    .mapErr((error) =>
      signal.aborted
        ? new ResearchJobInterruptedError('調査を中断しました。', error)
        : error,
    )
    .andThen((snapshots) => {
      const snapshotById = new Map(
        snapshots.map((snapshot) => [snapshot.sourceId, snapshot]),
      )
      const attemptedSnapshots: SourceBodyRollback[] = []
      const saveNext = (index: number): ResultAsync<void, Error> => {
        const plan = plans[index]
        if (plan === undefined) return okAsync(undefined)
        if (
          !plan.saveBody ||
          plan.source.body === undefined ||
          plan.source.body === null
        )
          return saveNext(index + 1)

        const snapshot = snapshotById.get(plan.id)
        if (snapshot === undefined)
          return errAsync(new Error('資料本文の保存前確認に失敗しました。'))
        attemptedSnapshots.push({
          ...snapshot,
          expectedBody: plan.source.body,
        })
        return saveSourceBodyIfUnchanged(
          fetcher,
          articleId,
          plan.id,
          snapshot.body,
          plan.source.body,
          signal,
        ).andThen(() => saveNext(index + 1))
      }

      return saveNext(0)
        .map(() => attemptedSnapshots)
        .orElse((saveError) =>
          rollbackSourceBodies(fetcher, articleId, attemptedSnapshots).andThen(
            () =>
              errAsync(
                signal.aborted
                  ? new ResearchJobInterruptedError(
                      '調査を中断しました。',
                      saveError,
                    )
                  : saveError,
              ),
          ),
        )
    })
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
      if (
        current?.url !== plan.url ||
        current.status !== plan.existing.status ||
        current.summary !== plan.existing.summary ||
        current.checkedAt !== plan.existing.checkedAt
      )
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
  researchedHeading: string | undefined,
): Result<void, Error> {
  const checkedAt = new Date().toISOString()
  return doc.transact(() => {
    for (const plan of plans) {
      const isAvailable =
        plan.source.status === 'available' &&
        (plan.saveBody ||
          (plan.existing !== undefined && !isUnfetchedSource(plan.existing)))
      const unfetchedStatus =
        plan.source.status === 'login_required'
          ? ('loginRequired' as const)
          : ('unavailable' as const)
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
            publishedAt: plan.source.published_at ?? null,
            status: isAvailable ? 'ready' : unfetchedStatus,
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
          ...(researchedHeading === undefined ? {} : { researchedHeading }),
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
  researchedHeading: string | undefined,
  signal: AbortSignal,
  onProgress: (step: ResearchJobProgress) => void,
  onSaving: () => void,
): ResultAsync<void, Error> {
  return runResearchJob(
    fetcher,
    settings,
    { task: 'key_points', question },
    signal,
    onProgress,
  ).andThen((result) =>
    saveResearchJobResult(
      fetcher,
      articleId,
      doc,
      result,
      researchedHeading,
      signal,
      onSaving,
    ).map(() => undefined),
  )
}

export function saveResearchJobResult(
  fetcher: typeof fetch,
  articleId: string,
  doc: Y.Doc,
  result: ResearchJobResult,
  researchedHeading: string | undefined,
  signal: AbortSignal,
  onSaving: () => void,
): ResultAsync<SavedResearchJobResult, Error> {
  const plans = planSources(doc, result)
  const sourceSnapshots = snapshotResearchSources(plans)
  const validationError = validateSourceChanges(doc, plans)
  if (validationError) return errAsync(validationError)
  onSaving()
  return saveBodies(fetcher, articleId, plans, signal).andThen(
    (savedSourceRollbacks) => {
      if (signal.aborted)
        return rollbackSourceBodies(
          fetcher,
          articleId,
          savedSourceRollbacks,
        ).andThen(() =>
          errAsync(new ResearchJobInterruptedError('調査を中断しました。')),
        )
      const error = validateSourceChanges(doc, plans)
      if (error)
        return rollbackSourceBodies(
          fetcher,
          articleId,
          savedSourceRollbacks,
        ).andThen(() => errAsync(error))
      const saveResult = saveResultInDocument(doc, plans, researchedHeading)
      if (saveResult.isErr())
        return rollbackSourceBodies(
          fetcher,
          articleId,
          savedSourceRollbacks,
        ).andThen(() => err(saveResult.error))
      const savedSourceSnapshots = captureSavedResearchSources(
        doc,
        sourceSnapshots,
      )
      const sources = plans.map(({ id, title, url, source }) => ({
        id,
        researchId: source.id,
        title,
        url,
        status: source.status,
        ...(typeof source.body === 'string' ? { body: source.body } : {}),
      }))
      return okAsync({
        sources,
        rollback: () => {
          const documentRollback = restoreResearchSources(
            doc,
            savedSourceSnapshots,
          )
          if (documentRollback.isErr()) return errAsync(documentRollback.error)
          const preservedSourceIds = new Set(documentRollback.value)
          return rollbackSourceBodies(
            fetcher,
            articleId,
            savedSourceRollbacks.filter(
              ({ sourceId }) => !preservedSourceIds.has(sourceId),
            ),
          ).map(() => documentRollback.value)
        },
      })
    },
  )
}
