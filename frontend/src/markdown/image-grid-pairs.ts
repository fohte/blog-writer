export type ImageGridTagSource = Readonly<{
  from: number
  to: number
  source: string
}>

export type ImageGridTagPair<T extends ImageGridTagSource> = Readonly<{
  opening: T
  closing: T
  range: Readonly<{ from: number; to: number }>
}>

function isOpeningTag(source: string): boolean {
  return /^<ImageGrid[ \t]*>$/u.test(source.trim())
}

function isClosingTag(source: string): boolean {
  return /^<\/ImageGrid[ \t]*>$/u.test(source.trim())
}

export function pairImageGridTags<T extends ImageGridTagSource>(
  tags: readonly T[],
): ImageGridTagPair<T>[] {
  const pairs: ImageGridTagPair<T>[] = []
  let opening: T | undefined

  for (const tag of tags) {
    if (isOpeningTag(tag.source)) {
      opening = tag
      continue
    }
    if (!opening || !isClosingTag(tag.source)) continue

    pairs.push({
      opening,
      closing: tag,
      range: { from: opening.from, to: tag.to },
    })
    opening = undefined
  }

  return pairs
}
