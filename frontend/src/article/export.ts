import { okAsync, ResultAsync } from 'neverthrow'

import { DEFAULT_ARTICLE_TITLE } from '#article/constants'

export type ExportFormat = 'markdown' | 'mdx'

export function prependArticleFrontmatter(
  frontmatter: string,
  body: string,
): string {
  return `---\n${frontmatter}\n---\n\n${body}`
}

export function createArticleFrontmatter(
  template: string,
  title: string,
  createdAt: number,
): string {
  const date = new Date(createdAt).toISOString().slice(0, 10)
  return template
    .replaceAll('{{ title }}', JSON.stringify(title))
    .replaceAll('{{ date }}', JSON.stringify(date))
}

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
const phrasingParents = new Set([
  'delete',
  'emphasis',
  'heading',
  'link',
  'linkReference',
  'paragraph',
  'strong',
  'tableCell',
])
const htmlRewritePattern = new RegExp(
  `<!--[\\s\\S]*?-->|<(${[...voidHtmlElements].join('|')})(?=[\\s/>])((?:"[^"]*"|'[^']*'|[^<>"'])*?)\\s*\\/?>`,
  'gi',
)

class ArticleExportError extends Error {
  constructor(cause: unknown) {
    super('MDX 形式に変換できませんでした。', { cause })
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

function getOpeningTag(
  value: string,
): { name: string; selfClosing: boolean } | undefined {
  const match = /^<([A-Za-z_$][\w$.-]*)(?:\s+[^<>]*)?\s*(\/?)>$/.exec(value)
  const name = match?.[1]
  if (name === undefined) return undefined
  return { name, selfClosing: match?.[2] === '/' }
}

function getClosingTagName(value: string): string | undefined {
  return /^<\/([A-Za-z_$][\w$.-]*)\s*>$/.exec(value)?.[1]
}

function rewriteHtml(node: ExportNode): void {
  if (node.type !== 'html' || node.value === undefined) return

  node.value = node.value.replace(
    htmlRewritePattern,
    (match, tagName: string | undefined, attributes: string | undefined) => {
      if (tagName === undefined) {
        const content = match.slice(4, -3).replaceAll('*/', '*\\/')
        return `{/*${content}*/}`
      }

      return `<${tagName}${(attributes ?? '').trimEnd()} />`
    },
  )
}

function rewritePhrasing(node: ExportNode): void {
  if (!phrasingParents.has(node.type) || node.children === undefined) return

  for (let index = 0; index < node.children.length; index += 1) {
    const current = node.children[index]
    if (
      !isExportNode(current) ||
      current.type !== 'html' ||
      current.value === undefined
    ) {
      continue
    }

    const openingTag = getOpeningTag(current.value)
    if (openingTag === undefined) {
      const closingTagName = getClosingTagName(current.value)
      if (
        closingTagName !== undefined &&
        !node.children.slice(0, index).some((candidate) => {
          if (!isExportNode(candidate) || candidate.type !== 'html')
            return false
          const candidateTag = getOpeningTag(candidate.value ?? '')
          return (
            candidateTag?.name === closingTagName && !candidateTag.selfClosing
          )
        })
      ) {
        current.type = 'text'
      }
      continue
    }

    if (
      voidHtmlElements.has(openingTag.name.toLowerCase()) ||
      editorComponents.has(openingTag.name) ||
      openingTag.selfClosing
    ) {
      continue
    }

    const hasClosingTag = node.children
      .slice(index + 1)
      .some(
        (candidate) =>
          isExportNode(candidate) &&
          candidate.type === 'html' &&
          getClosingTagName(candidate.value ?? '') === openingTag.name,
      )
    if (!hasClosingTag) current.type = 'text'
  }
}

function rewriteTree(node: ExportNode): void {
  rewriteHtml(node)
  rewritePhrasing(node)
  for (const child of node.children ?? []) {
    if (isExportNode(child)) rewriteTree(child)
  }
}

async function convertMdx(body: string): Promise<string> {
  const [{ remark }, { default: remarkMdx }, { default: remarkGfm }] =
    await Promise.all([
      import('remark'),
      import('remark-mdx'),
      import('remark-gfm'),
    ])
  const tree = remark().use(remarkGfm).parse(body)
  rewriteTree(tree)

  const processor = remark().use(remarkMdx).use(remarkGfm).data('settings', {
    bullet: '-',
    fences: true,
    resourceLink: true,
    rule: '-',
  })
  return processor.stringify(tree)
}

export function exportArticleBody(
  body: string,
  format: ExportFormat,
): ResultAsync<string, ArticleExportError> {
  if (format === 'markdown') return okAsync(body)

  return ResultAsync.fromPromise(
    convertMdx(body),
    (cause) => new ArticleExportError(cause),
  )
}

export function getArticleExportFilename(
  articleTitle: string,
  articleId: string,
  format: ExportFormat,
): string {
  const safeTitle = articleTitle
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
  const filenameBase =
    articleTitle.trim() === DEFAULT_ARTICLE_TITLE || safeTitle.length === 0
      ? articleId
      : safeTitle
  return `${filenameBase}.${format === 'markdown' ? 'md' : 'mdx'}`
}

export function downloadArticleFile(filename: string, contents: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: 'text/markdown;charset=utf-8' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}
