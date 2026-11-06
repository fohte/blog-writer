import { okAsync, ResultAsync } from 'neverthrow'
import { remark } from 'remark'
import remarkMdx from 'remark-mdx'

export type ExportFormat = 'markdown' | 'mdx'

const editorComponents = new Set([
  'CardLink',
  'ImageGrid',
  'Kbd',
  'SpeakerDeck',
])
const voidHtmlElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

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

  node.value = `{/*${(match[1] ?? '').replaceAll('*/', '*\\/')}*/}`
}

function rewriteParagraph(node: ExportNode): void {
  if (node.type !== 'paragraph' || node.children === undefined) return

  for (let index = 0; index < node.children.length; index += 1) {
    const previous = node.children[index - 1]
    const current = node.children[index]
    if (
      !isExportNode(current) ||
      current.type !== 'html' ||
      current.value === undefined
    ) {
      continue
    }

    const tag = /^<([A-Za-z][\w-]*)([^>]*)\s*\/?\s*>$/.exec(current.value)
    const tagName = tag?.[1]
    if (tagName === undefined) continue

    if (voidHtmlElements.has(tagName.toLowerCase())) {
      current.value = current.value.replace(/\s*\/?>$/, ' />')
      continue
    }

    if (editorComponents.has(tagName)) continue
    if (current.value.trimEnd().endsWith('/>')) continue

    const previousText =
      isExportNode(previous) && previous.type === 'text'
        ? (previous.value ?? '')
        : ''
    const nextClose = node.children
      .slice(index + 1)
      .some(
        (candidate) =>
          isExportNode(candidate) &&
          candidate.type === 'html' &&
          candidate.value === `</${tagName}>`,
      )
    if (nextClose || !/[A-Za-z_$][\w$]*$/.test(previousText)) continue

    current.type = 'text'
  }
}

function rewriteTree(node: ExportNode): void {
  rewriteComment(node)
  rewriteParagraph(node)
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
