import {
  markdownImageData,
  type MarkdownImageSyntaxNode,
} from '#markdown/image-data'

type ImageGridTagSource = Readonly<{
  from: number
  to: number
  source: string
}>

type ImageGridPair<
  TTag extends ImageGridTagSource,
  TImage extends MarkdownImageSyntaxNode,
> = Readonly<{
  opening: TTag
  closing: TTag
  images: readonly TImage[]
  range: Readonly<{ from: number; to: number }>
}>

type AnalyzedImageGrid<
  TTag extends ImageGridTagSource,
  TImage extends MarkdownImageSyntaxNode,
> = ImageGridPair<TTag, TImage> & Readonly<{ renderable: boolean }>

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
  let nextImageIndex = 0
  let lineFrom = openingLineBreak + 1
  while (lineFrom < closingLineStart) {
    const nextLineBreak = markdown.indexOf('\n', lineFrom)
    const lineTo =
      nextLineBreak === -1 || nextLineBreak > closingLineStart
        ? closingLineStart
        : nextLineBreak
    const lineText = markdown.slice(lineFrom, lineTo)
    if (lineText.trim().length > 0) {
      const image = images[nextImageIndex]
      const nextImage = images[nextImageIndex + 1]
      if (
        !image ||
        image.from < lineFrom ||
        image.to > lineTo ||
        (nextImage !== undefined && nextImage.from < lineTo) ||
        lineText.trim() !== markdown.slice(image.from, image.to).trim()
      ) {
        return false
      }
      nextImageIndex += 1
    }
    if (lineTo === closingLineStart) break
    lineFrom = lineTo + 1
  }

  return nextImageIndex === images.length
}

export function pairImageGrids<
  TTag extends ImageGridTagSource,
  TImage extends MarkdownImageSyntaxNode,
>(
  markdown: string,
  tags: readonly TTag[],
  images: readonly TImage[],
): ImageGridPair<TTag, TImage>[] {
  const openings: Array<{ tag: TTag; images: TImage[] }> = []
  const grids: ImageGridPair<TTag, TImage>[] = []
  let imageIndex = 0

  for (const tag of tags) {
    while (imageIndex < images.length) {
      const image = images[imageIndex]
      if (!image || image.from >= tag.from) break
      for (const opening of openings) {
        if (image.from > opening.tag.to) opening.images.push(image)
      }
      imageIndex += 1
    }
    if (!isTopLevelTag(markdown, tag)) continue
    const source = withoutTrailingWhitespace(tag.source)
    if (/^<ImageGrid[ \t]*>$/u.test(source)) {
      openings.push({ tag, images: [] })
      continue
    }
    if (!/^<\/ImageGrid[ \t]*>$/u.test(source)) continue

    const opening = openings.pop()
    if (!opening) continue
    grids.push({
      opening: opening.tag,
      closing: tag,
      images: opening.images.filter((image) => image.to < tag.from),
      range: { from: opening.tag.from, to: tag.to },
    })
  }

  return grids
}

export function analyzeImageGrids<
  TTag extends ImageGridTagSource,
  TImage extends MarkdownImageSyntaxNode,
>(
  markdown: string,
  tags: readonly TTag[],
  images: readonly TImage[],
): AnalyzedImageGrid<TTag, TImage>[] {
  return pairImageGrids(markdown, tags, images).map((grid) => ({
    ...grid,
    renderable: hasImageOnlyContent(
      markdown,
      grid.opening,
      grid.closing,
      grid.images,
    ),
  }))
}
