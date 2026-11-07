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
import { writeFromKeyPoints } from '#proposals/write-from-key-points'
import { HeadingResearchOutline } from '#research/heading-research-outline'
import { SourcePanel } from '#research/source-panel'
import { useClaimEvidence } from '#research/use-claim-evidence'
import { useHeadingResearch } from '#research/use-heading-research'

const MAX_CLAIM_CONTEXT_CHARS = 1000

export function App() {
  const [showSettings, setShowSettings] = useState(false)
  const {
    cancelResearch,
    progress: researchProgress,
    startResearch,
  } = useHeadingResearch()
  const claimEvidence = useClaimEvidence()
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
              id: 'verify-claim-evidence',
              label: '根拠を確かめる',
              onSelect: ({ context: requestContext }) => {
                const [before = '', rest = ''] = requestContext.section.split(
                  '⟪依頼範囲の開始⟫',
                  2,
                )
                const [selected = '', after = ''] = rest.split(
                  '⟪依頼範囲の終了⟫',
                  2,
                )
                const boundedBefore = before.slice(-MAX_CLAIM_CONTEXT_CHARS)
                const boundedAfter = after.slice(0, MAX_CLAIM_CONTEXT_CHARS)
                claimEvidence.startResearch({
                  articleId: context.articleId,
                  doc: context.doc,
                  claim: selected || requestContext.target,
                  range: requestContext.range,
                  ...(boundedBefore.length === 0
                    ? {}
                    : { before: boundedBefore }),
                  ...(boundedAfter.length === 0 ? {} : { after: boundedAfter }),
                })
              },
            },
            {
              id: 'research-from-heading',
              label: 'この見出しについて調べる',
              onSelect: ({ context: requestContext, instruction }) => {
                const sectionHeading = requestContext.section
                  .split('\n', 1)[0]
                  ?.replaceAll('⟪依頼範囲の開始⟫', '')
                  .replaceAll('⟪依頼範囲の終了⟫', '')
                  .trim()
                const headingText =
                  sectionHeading !== undefined &&
                  /^#{1,6}(?:[ \t]+|$)/u.test(sectionHeading)
                    ? sectionHeading.replace(/^#{1,6}(?:[ \t]+|$)/u, '').trim()
                    : ''
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
            {
              id: 'write-from-key-points',
              label: '資料をもとに書く',
              createProposal: (selection, signal) =>
                writeFromKeyPoints(context.doc, selection, signal),
            },
          ]}
          view={context.view}
        />
      )}
      editorExtensions={({ doc, history }) => [
        ...bodyRequestExtensions({ doc, history }),
        claimEvidence.editorExtension(doc),
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
          busy={[
            researchProgress[context.articleId]?.status,
            claimEvidence.progress[context.articleId]?.status,
          ].some(
            (status) =>
              status === 'running' ||
              status === 'saving' ||
              status === 'cancelling',
          )}
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
        const claimProgress = claimEvidence.progress[context.articleId]
        const claimResearchActive =
          claimProgress?.status === 'running' ||
          claimProgress?.status === 'saving' ||
          claimProgress?.status === 'cancelling'
        const headingProgress = researchProgress[context.articleId]
        const headingResearchActive =
          headingProgress?.status === 'running' ||
          headingProgress?.status === 'saving' ||
          headingProgress?.status === 'cancelling'
        const progress = claimResearchActive
          ? claimProgress
          : headingResearchActive
            ? headingProgress
            : claimProgress?.status === 'failed'
              ? claimProgress
              : (headingProgress ?? claimProgress)
        return (
          <SourcePanel
            articleId={context.articleId}
            doc={context.doc}
            researchError={claimEvidence.recheckErrors[context.articleId]}
            researchProgress={
              progress === undefined
                ? undefined
                : {
                    ...progress,
                    ...(progress.status === 'running' ||
                    progress.status === 'saving'
                      ? {
                          onCancel: claimResearchActive
                            ? () => {
                                claimEvidence.cancelResearch(context.articleId)
                              }
                            : () => {
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
