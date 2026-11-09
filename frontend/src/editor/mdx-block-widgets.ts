import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { Decoration, type DecorationSet } from '@codemirror/view'

import { createMarkdownImagePreview } from '#components/markdown-image-preview'
import { createMdxCardLinkPreview } from '#components/mdx-card-link-preview'
import { createMdxImageGridPreview } from '#components/mdx-image-grid-preview'
import { createMdxSpeakerDeckPreview } from '#components/mdx-speaker-deck-preview'
import { createBlockWidget } from '#editor/block-widget'
import type { BlockWidgetExclusionRange } from '#editor/markdown-block-widget-exclusions'
import {
  imageData,
  type MarkdownSyntaxNode,
  selectionTouches,
} from '#editor/markdown-block-widget-utils'
import type { OgpFetcher } from '#lib/ogp-api'

type BlockRange = Readonly<{ from: number; to: number }>

interface MdxBlockWidgets {
  decorations: DecorationSet
  imageGridRanges: BlockRange[]
  ranges: BlockRange[]
}

function componentTag(state: EditorState, node: MarkdownSyntaxNode) {
  const source = state.doc.sliceString(node.from, node.to).trim()
  const match = /^<(\/)?([A-Z][A-Za-z0-9]*)\b([\s\S]*?)\/?>(?:\s*)$/u.exec(
    source,
  )
  if (!match) return null
  return {
    closing: match[1] === '/',
    name: match[2] ?? '',
    attributes: match[3] ?? '',
    selfClosing: /\/>$/u.test(source),
  }
}

function attribute(value: string, name: string): string | undefined {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'u',
  ).exec(value)
  return match?.[1] ?? match?.[2]
}

function isExcluded(
  range: BlockRange,
  exclusions: readonly BlockWidgetExclusionRange[],
): boolean {
  return exclusions.some((excluded) =>
    excluded.from === excluded.to
      ? excluded.from >= range.from && excluded.from <= range.to
      : excluded.from < range.to && excluded.to > range.from,
  )
}

function safeCardUrl(value: string | undefined): string | null {
  if (value === undefined || value.length === 0 || !URL.canParse(value))
    return null
  const url = new URL(value)
  return url.protocol === 'http:' || url.protocol === 'https:' ? value : null
}

export function mdxImageGridImageExclusions(
  state: EditorState,
): BlockWidgetExclusionRange[] {
  const tags: MarkdownSyntaxNode[] = []
  const images: MarkdownSyntaxNode[] = []
  const cursor = syntaxTree(state).cursor()
  while (cursor.next()) {
    if (cursor.name === 'MdxComponentTag') tags.push(cursor.node)
    if (cursor.name === 'Image') images.push(cursor.node)
  }

  const ranges: BlockWidgetExclusionRange[] = []
  for (let index = 0; index < tags.length; index += 1) {
    const opening = tags[index]
    if (!opening) continue
    const openingTag = componentTag(state, opening)
    if (openingTag?.name !== 'ImageGrid' || openingTag.closing) continue
    const closing = tags.slice(index + 1).find((tag) => {
      const info = componentTag(state, tag)
      return info?.closing === true && info.name === 'ImageGrid'
    })
    if (!closing || !selectionTouches(state, opening.from, closing.to)) continue
    ranges.push(
      ...images
        .filter((image) => image.from > opening.to && image.to < closing.from)
        .map((image) => ({ from: image.from, to: image.to })),
    )
  }
  return ranges
}

export function buildMdxBlockWidgetDecorations(
  state: EditorState,
  exclusions: readonly BlockWidgetExclusionRange[],
  fetchOgp: OgpFetcher | undefined,
): MdxBlockWidgets {
  const tags: MarkdownSyntaxNode[] = []
  const images: MarkdownSyntaxNode[] = []
  const decorations = []
  const ranges: BlockRange[] = []
  const imageGridRanges: BlockRange[] = []
  const cursor = syntaxTree(state).cursor()
  while (cursor.next()) {
    if (cursor.name === 'MdxComponentTag') tags.push(cursor.node)
    if (cursor.name === 'Image') images.push(cursor.node)
  }

  const grids: Array<{ images: MarkdownSyntaxNode[]; range: BlockRange }> = []
  for (let index = 0; index < tags.length; index += 1) {
    const opening = tags[index]
    if (!opening) continue
    const openingTag = componentTag(state, opening)
    if (openingTag?.name !== 'ImageGrid' || openingTag.closing) continue

    const closing = tags.slice(index + 1).find((tag) => {
      const info = componentTag(state, tag)
      return info?.closing === true && info.name === 'ImageGrid'
    })
    if (!closing) continue

    const range = { from: opening.from, to: closing.to }
    imageGridRanges.push(range)
    const containedImages = images.filter(
      (image) => image.from > opening.to && image.to < closing.from,
    )
    grids.push({ images: containedImages, range })
  }

  for (const { images: gridImages, range } of grids) {
    if (
      selectionTouches(state, range.from, range.to) ||
      isExcluded(range, exclusions)
    )
      continue

    const source = state.doc.sliceString(range.from, range.to)
    const widget = createBlockWidget(
      () =>
        createMdxImageGridPreview({
          images: gridImages.flatMap((node) => {
            const image = imageData(state, node)
            return image
              ? [
                  createMarkdownImagePreview({
                    alt: image.alt,
                    source: image.source,
                    src: image.src,
                  }),
                ]
              : []
          }),
        }),
      `mdx:image-grid:${source}`,
      { sourceFrom: range.from, sourceRange: range, state },
    )
    decorations.push(
      Decoration.replace({ widget, block: true }).range(range.from, range.to),
    )
    ranges.push(range)
  }

  for (const node of tags) {
    const tag = componentTag(state, node)
    if (!tag || tag.closing || !tag.selfClosing) continue

    const range = { from: node.from, to: node.to }
    if (
      selectionTouches(state, range.from, range.to) ||
      isExcluded(range, exclusions) ||
      imageGridRanges.some(
        (grid) => node.from >= grid.from && node.to <= grid.to,
      )
    )
      continue

    let widget: ReturnType<typeof createBlockWidget> | undefined
    const source = state.doc.sliceString(range.from, range.to)
    if (tag.name === 'CardLink') {
      const href = safeCardUrl(attribute(tag.attributes, 'href'))
      if (href === null) continue
      widget = createBlockWidget(
        () => {
          const initial = createMdxCardLinkPreview({ href })
          if (fetchOgp) {
            void fetchOgp(href).match(
              (ogp) => {
                if (initial.isConnected && ogp.available)
                  initial.replaceWith(createMdxCardLinkPreview({ href, ogp }))
              },
              () => undefined,
            )
          }
          return initial
        },
        `mdx:card-link:${source}`,
        { sourceFrom: range.from, sourceRange: range, state },
      )
    } else if (tag.name === 'SpeakerDeck') {
      const id = attribute(tag.attributes, 'id')
      if (id === undefined || !/^[A-Za-z0-9]+$/u.test(id)) continue
      widget = createBlockWidget(
        () => createMdxSpeakerDeckPreview({ id }),
        `mdx:speaker-deck:${source}`,
        { sourceFrom: range.from, sourceRange: range, state },
      )
    }

    if (widget) {
      decorations.push(
        Decoration.replace({ widget, block: true }).range(range.from, range.to),
      )
      ranges.push(range)
    }
  }

  return {
    decorations: Decoration.set(decorations, true),
    imageGridRanges,
    ranges,
  }
}
