import { useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'

import { readBody } from '#article/body'
import {
  createArticleFrontmatter,
  exportArticleBody,
  isValidArticleSlug,
  prependArticleFrontmatter,
} from '#article/export'
import { ArticlePublishView } from '#components/article-publish-view'
import {
  ExportConflictError,
  type ExportDestination,
  getExportArticleFile,
  publishArticle,
} from '#lib/article-export-api'
import type { Article, SyncClientApi } from '#lib/sync-client'

type ArticlePublishContainerProps = {
  article: Article
  doc: Y.Doc
  destinations: ExportDestination[]
  client: SyncClientApi
  onDiffChange: (showing: boolean) => void
}

type PreparedPublish = {
  destinationId: string
  slug: string
  frontmatter: string
  body: string
  content: string
  sha: string | null
  original: string
}

function publishFingerprint(
  destinationId: string,
  slug: string,
  frontmatter: string,
  body: string,
) {
  return JSON.stringify([destinationId, slug, frontmatter, body])
}

function defaultFrontmatter(destination: ExportDestination, article: Article) {
  return createArticleFrontmatter(
    destination.frontmatter_template,
    article.title,
    article.createdAt,
  )
}

export function ArticlePublishContainer({
  article,
  doc,
  destinations,
  client,
  onDiffChange,
}: ArticlePublishContainerProps) {
  const initialDestinationId = article.exportDestinationId
  const initialDestination = destinations.find(
    ({ id }) => id === initialDestinationId,
  )
  const [destinationId, setDestinationId] = useState(initialDestinationId ?? '')
  const [slug, setSlug] = useState(article.exportSlug ?? '')
  const [frontmatter, setFrontmatter] = useState(
    article.exportFrontmatter ??
      (initialDestination === undefined
        ? ''
        : defaultFrontmatter(initialDestination, article)),
  )
  const frontmatterPersisted = useRef(article.exportFrontmatter !== undefined)
  const initialFrontmatterNeedsPersistence = useRef(
    article.exportFrontmatter === undefined && initialDestination !== undefined,
  )
  const [body, setBody] = useState(() => readBody(doc))
  const [prepared, setPrepared] = useState<PreparedPublish>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [publishedUrl, setPublishedUrl] = useState<string>()

  useEffect(() => {
    const articleBody = doc.getText('body')
    const updateBody = () => {
      setBody(articleBody.toJSON())
    }
    articleBody.observe(updateBody)
    updateBody()
    return () => {
      articleBody.unobserve(updateBody)
    }
  }, [doc])

  useEffect(() => {
    if (!initialFrontmatterNeedsPersistence.current) return
    initialFrontmatterNeedsPersistence.current = false
    frontmatterPersisted.current = true
    client
      .updateArticleExportSettings(article.id, {
        exportFrontmatter: frontmatter,
      })
      .match(
        () => {},
        (updateError) => {
          setError(updateError.message)
        },
      )
  }, [article.id, client, frontmatter])

  const currentFingerprint = publishFingerprint(
    destinationId,
    slug,
    frontmatter,
    body,
  )
  const preparedFingerprint = prepared
    ? publishFingerprint(
        prepared.destinationId,
        prepared.slug,
        prepared.frontmatter,
        prepared.body,
      )
    : undefined

  function updateSettings(next: {
    destinationId?: string
    slug?: string
    frontmatter?: string
  }) {
    client
      .updateArticleExportSettings(article.id, {
        ...(next.destinationId === undefined
          ? {}
          : { exportDestinationId: next.destinationId }),
        ...(next.slug === undefined ? {} : { exportSlug: next.slug }),
        ...(next.frontmatter === undefined
          ? {}
          : { exportFrontmatter: next.frontmatter }),
      })
      .match(
        () => {},
        (updateError) => {
          setError(updateError.message)
        },
      )
  }

  function handleDestinationChange(nextId: string) {
    const nextDestination = destinations.find(({ id }) => id === nextId)
    if (!nextDestination) return
    setDestinationId(nextId)
    setPrepared(undefined)
    setPublishedUrl(undefined)
    if (frontmatterPersisted.current) {
      updateSettings({ destinationId: nextId })
    } else {
      const nextFrontmatter = defaultFrontmatter(nextDestination, article)
      setFrontmatter(nextFrontmatter)
      frontmatterPersisted.current = true
      updateSettings({ destinationId: nextId, frontmatter: nextFrontmatter })
    }
    onDiffChange(false)
  }

  async function handleShowDiff() {
    const destination = destinations.find(({ id }) => id === destinationId)
    if (!destination || !isValidArticleSlug(slug)) return
    setBusy(true)
    setError(undefined)
    setPublishedUrl(undefined)
    const exportResult = await exportArticleBody(
      body,
      destination.format,
    ).match(
      (value) => ({ content: value }) as const,
      (exportError) => ({ error: exportError.message }) as const,
    )
    if ('error' in exportResult) {
      setError(exportResult.error)
      setBusy(false)
      return
    }
    const content = prependArticleFrontmatter(frontmatter, exportResult.content)
    const fileResult = await getExportArticleFile(
      fetch,
      destinationId,
      article.id,
      slug,
    ).match(
      (value) => ({ file: value }) as const,
      (requestError) => ({ error: requestError.message }) as const,
    )
    if ('error' in fileResult) {
      setError(fileResult.error)
      setBusy(false)
      return
    }
    setPrepared({
      destinationId,
      slug,
      frontmatter,
      body,
      content,
      sha: fileResult.file.sha,
      original: fileResult.file.content ?? '',
    })
    onDiffChange(true)
    setBusy(false)
  }

  async function handlePublish() {
    if (!prepared || preparedFingerprint !== currentFingerprint) return
    setBusy(true)
    setError(undefined)
    const result = await publishArticle(fetch, destinationId, article.id, {
      slug: prepared.slug,
      content: prepared.content,
      sha: prepared.sha,
    }).match(
      (response) => ({ url: response.url }) as const,
      (requestError) => ({ error: requestError }) as const,
    )
    if ('error' in result) {
      setError(result.error.message)
      if (result.error instanceof ExportConflictError) {
        setPrepared(undefined)
        onDiffChange(false)
      }
    } else {
      setPrepared(undefined)
      setPublishedUrl(result.url)
      onDiffChange(false)
    }
    setBusy(false)
  }

  return (
    <ArticlePublishView
      canPublish={preparedFingerprint === currentFingerprint}
      destinations={destinations}
      diff={
        prepared === undefined
          ? undefined
          : { original: prepared.original, modified: prepared.content }
      }
      error={error}
      frontmatter={frontmatter}
      onDestinationChange={handleDestinationChange}
      onFrontmatterChange={(value) => {
        setFrontmatter(value)
        frontmatterPersisted.current = true
        updateSettings({ frontmatter: value })
      }}
      onPublish={() => {
        void handlePublish()
      }}
      onShowDiff={() => {
        void handleShowDiff()
      }}
      onSlugChange={(value) => {
        setSlug(value)
        setPublishedUrl(undefined)
        updateSettings({ slug: value })
      }}
      publishedUrl={publishedUrl}
      selectedDestinationId={destinationId}
      slug={slug}
      busy={busy}
    />
  )
}
