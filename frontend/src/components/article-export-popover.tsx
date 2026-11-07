import { Button } from '@fohte/ui/button'
import { Panel } from '@fohte/ui/panel'
import { Popover, PopoverContent, PopoverTrigger } from '@fohte/ui/popover'
import { SegmentedControl } from '@fohte/ui/segmented-control'
import { useRef, useState } from 'react'
import type * as Y from 'yjs'

import { readBody } from '#article/body'
import {
  downloadArticleFile,
  exportArticleBody,
  type ExportFormat,
  getArticleExportFilename,
} from '#article/export'
import { ArticlePublishContainer } from '#components/article-publish-container'
import type { ExportDestination } from '#lib/article-export-api'
import type { Article, SyncClientApi } from '#lib/sync-client'

const formatOptions = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'mdx', label: 'MDX' },
] as const

type ArticleExportPopoverProps = {
  articleId: string
  articleTitle: string
  doc: Y.Doc
  defaultOpen?: boolean | undefined
  defaultFormat?: ExportFormat | undefined
  initialError?: string | undefined
  article?: Article | undefined
  destinations?: ExportDestination[] | undefined
  client?: SyncClientApi | undefined
  destinationError?: string | undefined
}

export function ArticleExportPopover({
  articleId,
  articleTitle,
  doc,
  defaultOpen = false,
  defaultFormat = 'markdown',
  initialError,
  article,
  destinations,
  client,
  destinationError,
}: ArticleExportPopoverProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [format, setFormat] = useState(defaultFormat)
  const [error, setError] = useState(initialError)
  const [showingPublishDiff, setShowingPublishDiff] = useState(false)
  const downloadButtonRef = useRef<HTMLButtonElement>(null)
  const conversionAttempt = useRef(0)

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      clearError()
      setShowingPublishDiff(false)
    }
  }

  function handleFormatChange(nextFormat: string) {
    if (nextFormat === 'markdown' || nextFormat === 'mdx') {
      setFormat(nextFormat)
      clearError()
    }
  }

  function clearError() {
    conversionAttempt.current += 1
    setError(undefined)
  }

  function handleDownload() {
    conversionAttempt.current += 1
    const attempt = conversionAttempt.current
    setError(undefined)
    void exportArticleBody(readBody(doc), format).match(
      (contents) => {
        downloadArticleFile(
          getArticleExportFilename(articleTitle, articleId, format),
          contents,
        )
      },
      (exportError) => {
        if (attempt === conversionAttempt.current) {
          setError(exportError.message)
        }
      },
    )
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger render={<Button type="button" variant="outline" />}>
        書き出す
      </PopoverTrigger>
      <PopoverContent
        className={
          showingPublishDiff
            ? 'flex flex-col gap-3'
            : 'flex w-64 max-w-full flex-col gap-3'
        }
        style={
          showingPublishDiff
            ? { width: '48rem', maxWidth: 'calc(100vw - 2rem)' }
            : undefined
        }
        initialFocus={downloadButtonRef}
      >
        <h2 className="font-semibold">形式</h2>
        <SegmentedControl
          aria-label="書き出し形式"
          onValueChange={handleFormatChange}
          options={formatOptions}
          value={format}
        />
        {error !== undefined && error.length > 0 ? (
          <Panel
            aria-live="assertive"
            className="rounded-md border-destructive/40 bg-destructive/10 text-sm text-destructive"
            padding="sm"
            role="alert"
          >
            {error}
          </Panel>
        ) : null}
        <Button onClick={handleDownload} ref={downloadButtonRef} type="button">
          ダウンロード
        </Button>
        {destinationError !== undefined ? (
          <Panel
            aria-live="assertive"
            className="rounded-md border-destructive/40 bg-destructive/10 text-sm text-destructive"
            padding="sm"
            role="alert"
          >
            {destinationError}
          </Panel>
        ) : null}
        {article !== undefined &&
        client !== undefined &&
        destinations !== undefined &&
        destinations.length > 0 ? (
          <>
            <div aria-hidden="true" className="border-t border-border" />
            <ArticlePublishContainer
              article={article}
              client={client}
              destinations={destinations}
              doc={doc}
              onDiffChange={setShowingPublishDiff}
            />
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
