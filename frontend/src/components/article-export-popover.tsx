import { Button } from '@fohte/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@fohte/ui/popover'
import { SegmentedControl } from '@fohte/ui/segmented-control'
import { useState } from 'react'

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
  body: string
  open?: boolean | undefined
  format?: ExportFormat | undefined
}

export function ArticleExportPopover({
  articleId,
  body,
  open,
  format,
}: ArticleExportPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [internalFormat, setInternalFormat] = useState<ExportFormat>('markdown')
  const [error, setError] = useState<string>()
  const isOpen = open ?? internalOpen
  const selectedFormat = format ?? internalFormat

  function handleOpenChange(nextOpen: boolean) {
    if (open === undefined) setInternalOpen(nextOpen)
  }

  function handleFormatChange(nextFormat: string) {
    if (
      format === undefined &&
      (nextFormat === 'markdown' || nextFormat === 'mdx')
    ) {
      setInternalFormat(nextFormat)
    }
  }

  function handleDownload() {
    setError(undefined)
    void exportArticleBody(body, selectedFormat).match(
      (contents) => {
        downloadArticleFile(
          getArticleExportFilename(articleId, selectedFormat),
          contents,
        )
      },
      (exportError) => {
        setError(exportError.message)
      },
    )
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={isOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" />}>
        書き出す
      </PopoverTrigger>
      <PopoverContent className="flex w-64 flex-col gap-3">
        <h2 className="font-semibold">形式</h2>
        <SegmentedControl
          aria-label="書き出し形式"
          onValueChange={handleFormatChange}
          options={formatOptions}
          value={selectedFormat}
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
