import { okAsync, ResultAsync } from 'neverthrow'
import { remark } from 'remark'
import remarkMdx from 'remark-mdx'

export type ExportFormat = 'markdown' | 'mdx'

class ArticleExportError extends Error {
  constructor(cause: unknown) {
    super('The article could not be converted to MDX.', { cause })
    this.name = 'ArticleExportError'
  }
}

type ExportNode = {
  type: string
  value?: string
  children?: unknown[]
}

function isExportNode(value: unknown): value is ExportNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  )
}

function rewriteComment(node: ExportNode): void {
  if (node.type !== 'html' || node.value === undefined) return

  const match = /^\s*<!--([\s\S]*?)-->\s*$/.exec(node.value)
  if (!match) return

  node.value = `{/*${match[1] ?? ''}*/}`
}

function rewriteArrayType(node: ExportNode): void {
  if (node.type !== 'paragraph' || node.children === undefined) return

  for (let index = 1; index < node.children.length; index += 1) {
    const previous = node.children[index - 1]
    const current = node.children[index]
    if (
      !isExportNode(previous) ||
      !isExportNode(current) ||
      previous.type !== 'text' ||
      current.type !== 'html' ||
      current.value !== '<T>' ||
      !/(^|\W)Array$/.test(previous.value ?? '')
    ) {
      continue
    }

    current.type = 'text'
  }
}

function rewriteTree(node: ExportNode): void {
  rewriteComment(node)
  rewriteArrayType(node)
  for (const child of node.children ?? []) {
    if (isExportNode(child)) rewriteTree(child)
  }
}

function convertMdx(body: string): string {
  const tree = remark().parse(body)
  rewriteTree(tree)

  const processor = remark().use(remarkMdx).data('settings', {
    fences: true,
    resourceLink: true,
  })
  return processor.stringify(tree)
}

export function exportArticleBody(
  body: string,
  format: ExportFormat,
): ResultAsync<string, ArticleExportError> {
  if (format === 'markdown') return okAsync(body)

  return ResultAsync.fromPromise(
    Promise.resolve().then(() => convertMdx(body)),
    (cause) => new ArticleExportError(cause),
  )
}

export function getArticleExportFilename(
  articleId: string,
  format: ExportFormat,
): string {
  return `${articleId}.${format === 'markdown' ? 'md' : 'mdx'}`
}

export function downloadArticleFile(filename: string, contents: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: 'text/markdown;charset=utf-8' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
