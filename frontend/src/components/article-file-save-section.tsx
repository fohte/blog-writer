import { Button } from '@fohte/ui/button'
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

type ArticleFileSaveSectionProps = {
  articleId: string
  articleTitle: string
  doc: Y.Doc
  defaultFormat?: ExportFormat | undefined
  initialError?: string | undefined
}

export function ArticleFileSaveSection({
  articleId,
  articleTitle,
  doc,
  defaultFormat = 'markdown',
  initialError,
}: ArticleFileSaveSectionProps) {
  const [format, setFormat] = useState(defaultFormat)
  const [error, setError] = useState(initialError)
  const conversionAttempt = useRef(0)

  function handleFormatChange(nextFormat: string) {
    if (nextFormat === 'markdown' || nextFormat === 'mdx') {
      setFormat(nextFormat)
      conversionAttempt.current += 1
      setError(undefined)
    }
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
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed text-muted-foreground-strong">
        本文を Markdown または MDX のファイルとして保存します。frontmatter
        は付きません。MDX では、HTML
        コメントのように壊れる書き方を書き換えます。
      </p>
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-xs font-bold text-muted-foreground-strong">
          形式
        </span>
        <SegmentedControl
          aria-label="書き出し形式"
          onValueChange={handleFormatChange}
          options={formatOptions}
          value={format}
        />
      </div>
      {error !== undefined && error.length > 0 ? (
        <p
          aria-live="assertive"
          className="text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div className="flex border-t border-border pt-4">
        <Button
          className="ml-auto"
          onClick={handleDownload}
          type="button"
          variant="solid"
        >
          ダウンロード
        </Button>
      </div>
    </div>
  )
}
