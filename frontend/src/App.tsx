import { useCallback, useEffect, useRef, useState } from 'react'

import type { ArticleEditorContext } from '#components/article-editor-view'
import { ArticleExportPopover } from '#components/article-export-popover'
import { ArticleFileSyncPopover } from '#components/article-file-sync-popover'
import { HeadingResearchAccessory } from '#components/heading-research-accessory'
import { LlmSettingsScreen } from '#components/llm-settings-screen'
import type { ResearchProgressStatus } from '#components/research-progress'
import {
  ExportApiError,
  type ExportDestination,
  getExportDestinations,
} from '#lib/article-export-api'
import {
  type FileSyncConfiguration,
  getFileSyncConfiguration,
} from '#lib/file-sync-api'
import { loadLlmSettings } from '#lib/llm-settings'
import { useSyncClient } from '#lib/use-sync-client'
import { ArticleWorkspace } from '#pages/article-workspace'
import { researchFromHeading } from '#research/research-from-heading'
import { SourcePanel } from '#research/source-panel'

type ResearchProgressState = {
  status: ResearchProgressStatus
  queries: string[]
  error?: string
}

function isConnectionInterrupted(message: string): boolean {
  return (
    message.includes('Failed to connect') ||
    message.includes('Failed to read LLM stream') ||
    message.includes('stream ended without a result')
  )
}

export function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [researchProgress, setResearchProgress] = useState<
    Record<string, ResearchProgressState>
  >({})
  const researchControllers = useRef(new Map<string, AbortController>())
  const [fileSyncConfiguration, setFileSyncConfiguration] =
    useState<FileSyncConfiguration>()
  const [fileSyncConfigurationError, setFileSyncConfigurationError] =
    useState<string>()
  const [exportDestinations, setExportDestinations] =
    useState<ExportDestination[]>()
  const [exportDestinationsError, setExportDestinationsError] =
    useState<string>()
  const {
    articles,
    statuses,
    client,
    canCreate,
    error,
    requiresAuthentication,
    createArticle,
  } = useSyncClient()

  const cancelResearch = useCallback((articleId: string) => {
    researchControllers.current.get(articleId)?.abort()
    researchControllers.current.delete(articleId)
    setResearchProgress((current) => ({
      ...current,
      [articleId]: {
        ...(current[articleId] ?? { status: 'running', queries: [] }),
        status: 'interrupted',
      },
    }))
  }, [])

  const startResearch = useCallback(
    (
      context: ArticleEditorContext,
      headingText: string,
      questionInput: string,
    ) => {
      if (researchControllers.current.has(context.articleId)) return
      const controller = new AbortController()
      researchControllers.current.set(context.articleId, controller)
      setResearchProgress((current) => ({
        ...current,
        [context.articleId]: { status: 'running', queries: [] },
      }))
      const settings = loadLlmSettings(() => window.localStorage)
      if (settings.isErr()) {
        if (researchControllers.current.get(context.articleId) !== controller)
          return
        researchControllers.current.delete(context.articleId)
        setResearchProgress((current) => ({
          ...current,
          [context.articleId]: {
            status: 'failed',
            queries: [],
            error: 'LLM 設定を読み込めませんでした。',
          },
        }))
        return
      }
      const question = questionInput.trim() || headingText
      void researchFromHeading(
        fetch,
        context.articleId,
        context.doc,
        settings.value,
        question,
        controller.signal,
        (query) => {
          setResearchProgress((current) => ({
            ...current,
            [context.articleId]: {
              ...(current[context.articleId] ?? {
                status: 'running',
                queries: [],
              }),
              status: 'running',
              queries: [...(current[context.articleId]?.queries ?? []), query],
            },
          }))
        },
        () => {
          setResearchProgress((current) => ({
            ...current,
            [context.articleId]: {
              ...(current[context.articleId] ?? {
                status: 'running',
                queries: [],
              }),
              status: 'saving',
            },
          }))
        },
      ).match(
        () => {
          if (researchControllers.current.get(context.articleId) !== controller)
            return
          researchControllers.current.delete(context.articleId)
          setResearchProgress((current) => ({
            ...current,
            [context.articleId]: {
              ...(current[context.articleId] ?? {
                status: 'running',
                queries: [],
              }),
              status: 'complete',
            },
          }))
        },
        (researchError) => {
          if (researchControllers.current.get(context.articleId) !== controller)
            return
          researchControllers.current.delete(context.articleId)
          const interrupted =
            controller.signal.aborted ||
            isConnectionInterrupted(researchError.message)
          setResearchProgress((current) => ({
            ...current,
            [context.articleId]: {
              ...(current[context.articleId] ?? {
                status: 'running',
                queries: [],
              }),
              status: interrupted ? 'interrupted' : 'failed',
              ...(interrupted ? {} : { error: researchError.message }),
            },
          }))
        },
      )
    },
    [],
  )

  useEffect(() => {
    const runningArticleId = Object.entries(researchProgress).find(
      ([, progress]) => progress.status === 'running',
    )?.[0]
    if (runningArticleId === undefined) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelResearch(runningArticleId)
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [cancelResearch, researchProgress])

  useEffect(
    () => () => {
      for (const controller of researchControllers.current.values())
        controller.abort()
      researchControllers.current.clear()
    },
    [],
  )

  useEffect(() => {
    let active = true
    void getFileSyncConfiguration(fetch).match(
      (configuration) => {
        if (active) {
          setFileSyncConfiguration(configuration)
          setFileSyncConfigurationError(undefined)
        }
      },
      (loadError) => {
        if (active) setFileSyncConfigurationError(loadError.message)
      },
    )
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void getExportDestinations(fetch).match(
      (response) => {
        if (active) {
          setExportDestinations(response.destinations)
          setExportDestinationsError(undefined)
        }
      },
      (loadError) => {
        if (!active) return
        if (loadError instanceof ExportApiError && loadError.status === 503) {
          setExportDestinations(undefined)
          setExportDestinationsError(undefined)
          return
        }
        setExportDestinationsError(loadError.message)
      },
    )
    return () => {
      active = false
    }
  }, [])

  if (showSettings) {
    return (
      <LlmSettingsScreen
        fileSyncDirectory={
          fileSyncConfiguration?.enabled === true
            ? (fileSyncConfiguration.directory ?? '')
            : undefined
        }
        fileSyncConfigurationError={fileSyncConfigurationError}
        onBack={() => {
          setShowSettings(false)
        }}
      />
    )
  }

  return (
    <ArticleWorkspace
      articles={articles}
      client={client}
      error={error}
      headerActions={(context: ArticleEditorContext) => {
        const article = articles.find(({ id }) => id === context.articleId)
        return (
          <>
            <ArticleExportPopover
              articleId={context.articleId}
              articleTitle={article?.title ?? ''}
              doc={context.doc}
              article={article}
              client={client}
              destinations={exportDestinations}
              destinationError={exportDestinationsError}
            />
            {fileSyncConfiguration?.enabled === true ? (
              <ArticleFileSyncPopover
                articleId={context.articleId}
                doc={context.doc}
                initialPath={article?.syncFilePath}
                initialStatus={article?.syncFileStatus ?? 'unset'}
                replaceBody={context.replaceBody}
              />
            ) : null}
          </>
        )
      }}
      outlineAccessory={(context, heading) => (
        <HeadingResearchAccessory
          busy={
            researchProgress[context.articleId]?.status === 'running' ||
            researchProgress[context.articleId]?.status === 'saving'
          }
          heading={heading}
          onResearch={(question) => {
            if (heading) startResearch(context, heading.text, question)
          }}
        />
      )}
      sourcesPanel={(context) => {
        const progress = researchProgress[context.articleId]
        return (
          <SourcePanel
            articleId={context.articleId}
            doc={context.doc}
            researchProgress={
              progress === undefined
                ? undefined
                : {
                    ...progress,
                    ...(progress.status === 'running'
                      ? {
                          onCancel: () => {
                            cancelResearch(context.articleId)
                          },
                        }
                      : {}),
                  }
            }
          />
        )
      }}
      onCreateArticle={createArticle}
      onOpenSettings={() => {
        setShowSettings(true)
      }}
      ready={canCreate}
      requiresAuthentication={requiresAuthentication}
      statuses={statuses}
    />
  )
}
