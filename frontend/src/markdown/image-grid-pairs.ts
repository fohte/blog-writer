import {
  markdownImageData,
  type MarkdownImageSyntaxNode,
} from '#markdown/image-data'

type ImageGridTagSource = Readonly<{
  from: number
  to: number
  source: string
}>

type ImageGrid<
  TTag extends ImageGridTagSource,
  TImage extends MarkdownImageSyntaxNode,
> = Readonly<{
  opening: TTag
  closing: TTag
  images: readonly TImage[]
  range: Readonly<{ from: number; to: number }>
  renderable: boolean
}>

function lineStartAt(markdown: string, position: number): number {
  return markdown.lastIndexOf('\n', position - 1) + 1
}

function isTopLevelTag(markdown: string, tag: ImageGridTagSource): boolean {
  return tag.from === lineStartAt(markdown, tag.from)
}

function withoutTrailingWhitespace(source: string): string {
  return source.replace(/[ \t]+$/u, '')
}

function hasImageOnlyContent(
  markdown: string,
  opening: ImageGridTagSource,
  closing: ImageGridTagSource,
  images: readonly MarkdownImageSyntaxNode[],
): boolean {
  if (
    images.length === 0 ||
    images.some((image) => markdownImageData(markdown, image) === null)
  )
    return false

  const openingLineBreak = markdown.indexOf('\n', opening.to)
  if (openingLineBreak === -1 || openingLineBreak >= closing.from) return false

  const closingLineStart = lineStartAt(markdown, closing.from)
  const seenImages = new Set<MarkdownImageSyntaxNode>()
  let lineFrom = openingLineBreak + 1
  while (lineFrom < closingLineStart) {
    const nextLineBreak = markdown.indexOf('\n', lineFrom)
    const lineTo =
      nextLineBreak === -1 || nextLineBreak > closingLineStart
        ? closingLineStart
        : nextLineBreak
    const lineText = markdown.slice(lineFrom, lineTo)
    if (lineText.trim().length > 0) {
      const lineImages = images.filter(
        (image) => image.from >= lineFrom && image.to <= lineTo,
      )
      const image = lineImages[0]
      if (
        lineImages.length !== 1 ||
        !image ||
        lineText.trim() !== markdown.slice(image.from, image.to).trim()
      ) {
        return false
      }
      seenImages.add(image)
    }
    if (lineTo === closingLineStart) break
    lineFrom = lineTo + 1
  }

  return seenImages.size === images.length
}

export function analyzeImageGrids<
  TTag extends ImageGridTagSource,
  TImage extends MarkdownImageSyntaxNode,
>(
  markdown: string,
  tags: readonly TTag[],
  images: readonly TImage[],
): ImageGrid<TTag, TImage>[] {
  const openings: TTag[] = []
  const grids: ImageGrid<TTag, TImage>[] = []

  for (const tag of tags) {
    if (!isTopLevelTag(markdown, tag)) continue
    const source = withoutTrailingWhitespace(tag.source)
    if (/^<ImageGrid[ \t]*>$/u.test(source)) {
      openings.push(tag)
      continue
    }
    if (!/^<\/ImageGrid[ \t]*>$/u.test(source)) continue

    const opening = openings.pop()
    if (!opening) continue
    const gridImages = images.filter(
      (image) => image.from > opening.to && image.to < tag.from,
    )
    grids.push({
      opening,
      closing: tag,
      images: gridImages,
      range: { from: opening.from, to: tag.to },
      renderable: hasImageOnlyContent(markdown, opening, tag, gridImages),
    })
  }

  return grids
}
