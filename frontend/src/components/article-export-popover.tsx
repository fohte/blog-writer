import { Button } from '@fohte/ui/button'
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
}

export function ArticleExportPopover({
  articleId,
  articleTitle,
  doc,
  defaultOpen = false,
  defaultFormat = 'markdown',
  initialError,
}: ArticleExportPopoverProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [format, setFormat] = useState(defaultFormat)
  const [error, setError] = useState(initialError)
  const conversionAttempt = useRef(0)

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) clearError()
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
      <PopoverContent className="flex w-64 flex-col gap-3">
        <h2 className="font-semibold">形式</h2>
        <SegmentedControl
          aria-label="書き出し形式"
          onValueChange={handleFormatChange}
          options={formatOptions}
          value={format}
        />
        {error !== undefined && error.length > 0 ? (
          <p role="alert">{error}</p>
        ) : null}
        <Button onClick={handleDownload} type="button">
          ダウンロード
        </Button>
      </PopoverContent>
    </Popover>
  )
}
