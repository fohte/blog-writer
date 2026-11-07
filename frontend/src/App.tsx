import { useEffect, useState } from 'react'

import type { ArticleEditorContext } from '#components/article-editor-view'
import { ArticleExportPopover } from '#components/article-export-popover'
import { ArticleFileSyncPopover } from '#components/article-file-sync-popover'
import { LlmSettingsScreen } from '#components/llm-settings-screen'
import {
  BodyRequestAccessory,
  bodyRequestExtensions,
  createOutlineProposalExtension,
  transitionProposalEditorExtensions,
} from '#editor/index'
import {
  ExportApiError,
  type ExportDestination,
  getExportDestinations,
} from '#lib/article-export-api'
import {
  type FileSyncConfiguration,
  getFileSyncConfiguration,
} from '#lib/file-sync-api'
import { useSyncClient } from '#lib/use-sync-client'
import { ArticleWorkspace } from '#pages/article-workspace'
import { PremiseProposalAccessory } from '#proposals/premise'
import { HeadingResearchOutline } from '#research/heading-research-outline'
import { SourcePanel } from '#research/source-panel'
import { useHeadingResearch } from '#research/use-heading-research'

export function App() {
  const [showSettings, setShowSettings] = useState(false)
  const {
    cancelResearch,
    progress: researchProgress,
    startResearch,
  } = useHeadingResearch()
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
      bodyAccessory={(context) => (
        <BodyRequestAccessory
          doc={context.doc}
          history={context.history}
          presets={[
            {
              id: 'research-from-heading',
              label: 'この見出しについて調べる',
              onSelect: ({ context: requestContext, instruction }) => {
                const headingText =
                  requestContext.headings
                    .at(-1)
                    ?.replace(/^#{1,6}(?:[ \t]+|$)/u, '')
                    .trim() ?? ''
                if (instruction.trim().length === 0 && headingText.length === 0)
                  return
                startResearch(
                  context.articleId,
                  context.doc,
                  headingText,
                  instruction,
                )
              },
            },
          ]}
          view={context.view}
        />
      )}
      editorExtensions={({ doc, history }) => [
        ...bodyRequestExtensions({ doc, history }),
        createOutlineProposalExtension({ doc, history }),
        ...transitionProposalEditorExtensions({ doc, history }),
      ]}
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
      onCreateArticle={createArticle}
      onOpenSettings={() => {
        setShowSettings(true)
      }}
      outlineRenderer={(context) => (
        <HeadingResearchOutline
          busy={
            researchProgress[context.articleId]?.status === 'running' ||
            researchProgress[context.articleId]?.status === 'saving' ||
            researchProgress[context.articleId]?.status === 'cancelling'
          }
          doc={context.doc}
          history={context.history}
          onResearch={(headingText, question) => {
            startResearch(context.articleId, context.doc, headingText, question)
          }}
          view={context.view}
          onHeadingSelected={context.onHeadingSelected}
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
                    ...(progress.status === 'running' ||
                    progress.status === 'saving'
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
      premiseAccessory={(context) => (
        <PremiseProposalAccessory doc={context.doc} />
      )}
      ready={canCreate}
      requiresAuthentication={requiresAuthentication}
      statuses={statuses}
    />
  )
}
