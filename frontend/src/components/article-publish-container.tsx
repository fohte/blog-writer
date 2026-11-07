import { useEffect, useState } from 'react'
import type * as Y from 'yjs'

import { readBody } from '#article/body'
import {
  createArticleFrontmatter,
  exportArticleBody,
  prependArticleFrontmatter,
} from '#article/export'
import { ArticlePublishView } from '#components/article-publish-view'
import {
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

const slugPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function publishFingerprint(
  destinationId: string,
  slug: string,
  frontmatter: string,
  body: string,
) {
  return JSON.stringify([destinationId, slug, frontmatter, body])
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
        : createArticleFrontmatter(
            initialDestination.frontmatter_template,
            article.title,
            article.createdAt,
          )),
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
    if (
      article.exportFrontmatter !== undefined ||
      initialDestination === undefined
    )
      return
    setFrontmatter((current) => {
      if (current.length > 0) return current
      const value = createArticleFrontmatter(
        initialDestination.frontmatter_template,
        article.title,
        article.createdAt,
      )
      client
        .updateArticleExportSettings(article.id, {
          exportFrontmatter: value,
        })
        .match(
          () => {},
          (updateError) => {
            setError(updateError.message)
          },
        )
      return value
    })
  }, [article, client, initialDestination])

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
    const nextFrontmatter = createArticleFrontmatter(
      nextDestination.frontmatter_template,
      article.title,
      article.createdAt,
    )
    setDestinationId(nextId)
    setFrontmatter(nextFrontmatter)
    setPrepared(undefined)
    setPublishedUrl(undefined)
    updateSettings({ destinationId: nextId, frontmatter: nextFrontmatter })
    onDiffChange(false)
  }

  async function handleShowDiff() {
    const destination = destinations.find(({ id }) => id === destinationId)
    if (!destination || !slugPattern.test(slug)) return
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
      (requestError) => ({ error: requestError.message }) as const,
    )
    if ('error' in result) {
      setError(result.error)
      if (
        result.error.includes('409') ||
        result.error.includes('変更されています')
      ) {
        setPrepared(undefined)
        onDiffChange(false)
      }
    } else {
      setPublishedUrl(result.url)
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
