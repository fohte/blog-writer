import { useState } from 'react'

import type { ArticleExportContext } from '#components/article-editor-view'
import {
  ArticleExportScreen,
  type ArticleExportSection,
} from '#components/article-export-screen'
import { ArticleFileSaveSection } from '#components/article-file-save-section'
import { ArticleFileSyncSection } from '#components/article-file-sync-section'
import { ArticlePublishContainer } from '#components/article-publish-container'
import { SyncStatus } from '#components/sync-status'
import type { ExportDestination } from '#lib/article-export-api'
import type { Article, SyncClientApi } from '#lib/sync-client'

type ArticleExportContainerProps = {
  context: ArticleExportContext
  article?: Article | undefined
  client?: SyncClientApi | undefined
  destinations?: ExportDestination[] | undefined
  destinationError?: string | undefined
  fileSyncEnabled: boolean
}

function describeFileSync(article: Article | undefined) {
  const path = article?.syncFilePath ?? ''
  switch (article?.syncFileStatus ?? 'unset') {
    case 'synced':
      return `✓ 同期済み · ${path}`
    case 'external_changed':
      return `! 外部で変更あり · ${path}`
    case 'unset':
      return '未設定'
  }
}

export function ArticleExportContainer({
  context,
  article,
  client,
  destinations,
  destinationError,
  fileSyncEnabled,
}: ArticleExportContainerProps) {
  const { articleId, doc, replaceBody, syncStatus, onBack } = context
  const canPublish =
    article !== undefined &&
    client !== undefined &&
    destinations !== undefined &&
    destinations.length > 0
  const sections = [
    ...(fileSyncEnabled
      ? [
          {
            value: 'sync' as const,
            label: '本文ファイルへ自動同期',
            detail: describeFileSync(article),
          },
        ]
      : []),
    ...(canPublish || destinationError !== undefined
      ? [
          {
            value: 'publish' as const,
            label: '公開先へ PR',
            detail:
              destinationError === undefined
                ? '差分を確認してから PR を作成'
                : '公開先を読み込めませんでした',
          },
        ]
      : []),
    {
      value: 'file' as const,
      label: 'ファイルに保存',
      detail: '.md / .mdx · frontmatter なし',
    },
  ]
  const [requested, setRequested] = useState<ArticleExportSection | undefined>(
    context.section,
  )
  const selected =
    sections.find(({ value }) => value === requested)?.value ??
    sections[0]?.value ??
    'file'

  return (
    <ArticleExportScreen
      articleTitle={article?.title ?? ''}
      onBack={onBack}
      onSelect={setRequested}
      sections={sections}
      selected={selected}
      status={syncStatus ? <SyncStatus state={syncStatus} /> : undefined}
    >
      {selected === 'sync' ? (
        <ArticleFileSyncSection
          articleId={articleId}
          doc={doc}
          initialPath={article?.syncFilePath}
          initialStatus={article?.syncFileStatus ?? 'unset'}
          replaceBody={replaceBody}
        />
      ) : null}
      {selected === 'publish' ? (
        <>
          {destinationError === undefined ? null : (
            <p
              aria-live="assertive"
              className="text-sm text-destructive"
              role="alert"
            >
              {destinationError}
            </p>
          )}
          {canPublish ? (
            <ArticlePublishContainer
              article={article}
              client={client}
              destinations={destinations}
              doc={doc}
            />
          ) : null}
        </>
      ) : null}
      {selected === 'file' ? (
        <ArticleFileSaveSection
          articleId={articleId}
          articleTitle={article?.title ?? ''}
          doc={doc}
        />
      ) : null}
    </ArticleExportScreen>
  )
}
