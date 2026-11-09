export type MarkdownImageSyntaxNode = Readonly<{
  firstChild: MarkdownImageSyntaxNode | null
  nextSibling: MarkdownImageSyntaxNode | null
  from: number
  name: string
  to: number
}>

type MarkdownSource =
  | string
  | Readonly<{
      lineAt: (position: number) => Readonly<{ from: number; to: number }>
      sliceString: (from: number, to: number) => string
    }>

function sliceString(source: MarkdownSource, from: number, to: number): string {
  return typeof source === 'string'
    ? source.slice(from, to)
    : source.sliceString(from, to)
}

function lineRange(source: MarkdownSource, position: number) {
  if (typeof source !== 'string') return source.lineAt(position)
  const from = source.lastIndexOf('\n', position - 1) + 1
  const newline = source.indexOf('\n', position)
  return { from, to: newline === -1 ? source.length : newline }
}

export function markdownImageData(
  source: MarkdownSource,
  node: MarkdownImageSyntaxNode,
) {
  const children: MarkdownImageSyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling)
    children.push(child)

  const marks = children.filter((child) => child.name === 'LinkMark')
  const url = children.find((child) => child.name === 'URL')
  const openingMark = marks[0]
  const altEndMark = marks[1]
  if (!openingMark || !altEndMark || marks.length < 4 || !url) return null

  const line = lineRange(source, node.from)
  const lineSource = sliceString(source, line.from, line.to)
  if (lineSource.trim() !== sliceString(source, node.from, node.to)) return null

  return {
    alt: sliceString(source, openingMark.to, altEndMark.from),
    from: line.from,
    lineTo: line.to,
    nodeFrom: node.from,
    source: lineSource,
    src: sliceString(source, url.from, url.to),
    to: line.to,
  }
}
