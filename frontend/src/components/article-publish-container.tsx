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
  const savedDestinationExists = destinations.some(
    ({ id }) => id === article.exportDestinationId,
  )
  const onlyDestination =
    destinations.length === 1 ? destinations[0] : undefined
  const autoSelectDestination =
    article.exportDestinationId === undefined ? onlyDestination : undefined
  const initialDestination =
    destinations.find(({ id }) => id === article.exportDestinationId) ??
    autoSelectDestination
  const initialDestinationId = initialDestination?.id
  const initialFrontmatter =
    article.exportFrontmatter ??
    (initialDestination === undefined
      ? ''
      : defaultFrontmatter(initialDestination, article))
  const [destinationId, setDestinationId] = useState<string | undefined>(
    initialDestinationId,
  )
  const [slug, setSlug] = useState(article.exportSlug ?? '')
  const [frontmatter, setFrontmatter] = useState(initialFrontmatter)
  const frontmatterPersisted = useRef(
    article.exportFrontmatter !== undefined || initialDestination !== undefined,
  )
  const initialSettings = {
    ...(autoSelectDestination === undefined
      ? {}
      : { exportDestinationId: autoSelectDestination.id }),
    ...(article.exportFrontmatter !== undefined ||
    initialDestination === undefined
      ? {}
      : { exportFrontmatter: initialFrontmatter }),
  }
  const initialSettingsToPersist = useRef(
    Object.keys(initialSettings).length === 0 ? undefined : initialSettings,
  )
  const [body, setBody] = useState(() => readBody(doc))
  const [prepared, setPrepared] = useState<PreparedPublish>()
  const [busyAction, setBusyAction] = useState<'diff' | 'publish'>()
  const [error, setError] = useState<string>()
  const [publishedUrl, setPublishedUrl] = useState<string>()
  const mounted = useRef(false)
  const requestId = useRef(0)

  const selectedDestination = destinations.find(
    ({ id }) => id === destinationId,
  )
  const selectedDestinationId = selectedDestination?.id
  const destinationUnavailable =
    article.exportDestinationId !== undefined && !savedDestinationExists

  function isCurrentRequest(id: number) {
    return mounted.current && requestId.current === id
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestId.current += 1
    }
  }, [])

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
    const settings = initialSettingsToPersist.current
    if (settings === undefined) return
    initialSettingsToPersist.current = undefined
    client.updateArticleExportSettings(article.id, settings).match(
      () => {},
      (updateError) => {
        setError(updateError.message)
      },
    )
  }, [article.id, client])

  const currentFingerprint = publishFingerprint(
    selectedDestinationId ?? '',
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

  async function loadDiff(preserveError: boolean) {
    const destination = selectedDestination
    const destinationId = selectedDestinationId
    if (
      destination === undefined ||
      destinationId === undefined ||
      !isValidArticleSlug(slug)
    ) {
      return
    }
    const currentRequestId = requestId.current + 1
    requestId.current = currentRequestId
    setBusyAction('diff')
    if (!preserveError) setError(undefined)
    setPublishedUrl(undefined)
    const exportResult = await exportArticleBody(
      body,
      destination.format,
    ).match(
      (value) => ({ content: value }) as const,
      (exportError) => ({ error: exportError.message }) as const,
    )
    if (!isCurrentRequest(currentRequestId)) return
    if ('error' in exportResult) {
      setError(exportResult.error)
      setBusyAction(undefined)
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
    if (!isCurrentRequest(currentRequestId)) return
    if ('error' in fileResult) {
      setError(fileResult.error)
      setBusyAction(undefined)
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
    setBusyAction(undefined)
  }

  function handleShowDiff() {
    void loadDiff(false)
  }

  async function handlePublish() {
    if (!prepared || preparedFingerprint !== currentFingerprint) return
    const currentRequestId = requestId.current + 1
    requestId.current = currentRequestId
    setBusyAction('publish')
    setError(undefined)
    const result = await publishArticle(
      fetch,
      prepared.destinationId,
      article.id,
      {
        slug: prepared.slug,
        content: prepared.content,
        sha: prepared.sha,
      },
    ).match(
      (response) => ({ url: response.url }) as const,
      (requestError) => ({ error: requestError }) as const,
    )
    if (!isCurrentRequest(currentRequestId)) return
    if ('error' in result) {
      setError(result.error.message)
      if (result.error instanceof ExportConflictError) {
        setPrepared(undefined)
        onDiffChange(false)
        await loadDiff(true)
        return
      }
    } else {
      setPrepared(undefined)
      setPublishedUrl(result.url)
      onDiffChange(false)
    }
    setBusyAction(undefined)
  }

  return (
    <ArticlePublishView
      canPublish={preparedFingerprint === currentFingerprint}
      destinations={destinations}
      destinationUnavailable={
        destinationUnavailable && selectedDestinationId === undefined
      }
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
      onShowDiff={handleShowDiff}
      onSlugChange={(value) => {
        setSlug(value)
        setPublishedUrl(undefined)
        updateSettings({ slug: value })
      }}
      publishedUrl={publishedUrl}
      selectedDestinationId={selectedDestinationId}
      slug={slug}
      busyAction={busyAction}
    />
  )
}
