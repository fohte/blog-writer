import { GFM, parser } from '@lezer/markdown'

export type TableAlignment = 'left' | 'center' | 'right' | null

export interface MarkdownTablePreviewProps {
  alignment: TableAlignment[]
  header: string[]
  rows: string[][]
}

type SyntaxNode = {
  firstChild: SyntaxNode | null
  nextSibling: SyntaxNode | null
  from: number
  name: string
  to: number
}

const inlineMarkdownParser = parser.configure(GFM)
const inlineNodeNames = new Set([
  'Autolink',
  'Emphasis',
  'Escape',
  'HardBreak',
  'Image',
  'InlineCode',
  'Link',
  'Strikethrough',
  'StrongEmphasis',
])

function childNodes(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling)
    children.push(child)
  return children
}

function alignmentClass(alignment: TableAlignment): string {
  if (alignment === 'center') return 'text-center'
  if (alignment === 'right') return 'text-right'
  return 'text-left'
}

function createInlineNode(
  node: SyntaxNode,
  source: string,
): HTMLElement | null {
  const children = childNodes(node)
  if (node.name === 'HardBreak') return document.createElement('br')

  if (node.name === 'Escape') {
    const escaped = document.createElement('span')
    escaped.textContent = source.slice(node.from, node.to).replace(/^\\/u, '')
    return escaped
  }

  if (node.name === 'InlineCode') {
    const marks = children.filter((child) => child.name === 'CodeMark')
    const code = document.createElement('code')
    code.className = 'rounded bg-muted/40 px-1'
    code.textContent = source.slice(
      marks[0]?.to ?? node.from,
      marks.at(-1)?.from ?? node.to,
    )
    return code
  }

  if (node.name === 'Image') {
    const url = children.find((child) => child.name === 'URL')
    const marks = children.filter((child) => child.name === 'LinkMark')
    const open = marks.find((mark) =>
      source.slice(mark.from, mark.to).endsWith('['),
    )
    const close = marks.find((mark) => source.slice(mark.from, mark.to) === ']')
    if (!url || !open || !close) return null

    const image = document.createElement('img')
    image.alt = source.slice(open.to, close.from)
    image.className = 'inline-block max-h-8 max-w-full align-middle'
    image.referrerPolicy = 'no-referrer'
    image.setAttribute('src', source.slice(url.from, url.to))
    image.addEventListener(
      'error',
      () => {
        image.replaceWith(
          document.createTextNode(source.slice(node.from, node.to)),
        )
      },
      { once: true },
    )
    return image
  }

  if (node.name === 'Link' || node.name === 'Autolink') {
    const url = children.find((child) => child.name === 'URL')
    if (!url) return null
    const href = source.slice(url.from, url.to)
    if (
      !URL.canParse(href) ||
      !['http:', 'https:', 'mailto:'].includes(new URL(href).protocol)
    )
      return null

    const marks = children.filter((child) => child.name === 'LinkMark')
    const open = marks.find((mark) => source.slice(mark.from, mark.to) === '[')
    const close = marks.find((mark) => source.slice(mark.from, mark.to) === ']')
    const labelFrom = open?.to ?? url.from
    const labelTo = close?.from ?? url.to
    const anchor = document.createElement('a')
    anchor.className = 'text-primary underline underline-offset-4'
    anchor.setAttribute('href', href)
    anchor.rel = 'noreferrer noopener'
    anchor.target = '_blank'
    appendInlineRange(
      anchor,
      source,
      labelFrom,
      labelTo,
      children.filter(
        (child) => child.from >= labelFrom && child.to <= labelTo,
      ),
    )
    return anchor
  }

  const tagName =
    node.name === 'StrongEmphasis'
      ? 'strong'
      : node.name === 'Strikethrough'
        ? 'del'
        : 'em'
  const markName =
    node.name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark'
  const marks = children.filter((child) => child.name === markName)
  const from = marks[0]?.to ?? node.from
  const to = marks.at(-1)?.from ?? node.to
  const element = document.createElement(tagName)
  appendInlineRange(
    element,
    source,
    from,
    to,
    children.filter((child) => child.from >= from && child.to <= to),
  )
  return element
}

function appendInlineRange(
  parent: ParentNode,
  source: string,
  from: number,
  to: number,
  nodes: SyntaxNode[],
): void {
  let offset = from
  for (const node of nodes) {
    if (!inlineNodeNames.has(node.name)) continue
    parent.append(document.createTextNode(source.slice(offset, node.from)))
    const element = createInlineNode(node, source)
    if (element) parent.append(element)
    else
      parent.append(document.createTextNode(source.slice(node.from, node.to)))
    offset = node.to
  }
  parent.append(document.createTextNode(source.slice(offset, to)))
}

function appendMarkdownCellContent(cell: HTMLElement, source: string): void {
  const paragraph = childNodes(inlineMarkdownParser.parse(source).topNode).find(
    (node) => node.name === 'Paragraph',
  )
  if (!paragraph) {
    cell.textContent = source
    return
  }
  appendInlineRange(cell, source, 0, source.length, childNodes(paragraph))
}

export function createMarkdownTablePreview({
  alignment,
  header,
  rows,
}: MarkdownTablePreviewProps): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'overflow-x-auto rounded-md border'
  const table = document.createElement('table')
  table.className = 'w-full border-collapse text-sm'
  const thead = document.createElement('thead')
  thead.className = 'bg-muted/50'
  const headerRow = document.createElement('tr')

  header.forEach((source, index) => {
    const cell = document.createElement('th')
    cell.className = `border-b px-3 py-2 font-medium ${alignmentClass(alignment[index] ?? null)}`
    cell.scope = 'col'
    appendMarkdownCellContent(cell, source)
    headerRow.append(cell)
  })
  thead.append(headerRow)

  const tbody = document.createElement('tbody')
  rows.forEach((row) => {
    const rowElement = document.createElement('tr')
    rowElement.className = 'last:[&>td]:border-b-0'
    header.forEach((_, columnIndex) => {
      const cell = document.createElement('td')
      cell.className = `border-b px-3 py-2 ${alignmentClass(alignment[columnIndex] ?? null)}`
      appendMarkdownCellContent(cell, row[columnIndex] ?? '')
      rowElement.append(cell)
    })
    tbody.append(rowElement)
  })

  table.append(thead, tbody)
  wrapper.append(table)
  return wrapper
}
