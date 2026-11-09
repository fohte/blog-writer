import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { Decoration, type DecorationSet } from '@codemirror/view'

import { createMarkdownImagePreview } from '#components/markdown-image-preview'
import { createMdxCardLinkPreview } from '#components/mdx-card-link-preview'
import { createMdxImageGridPreview } from '#components/mdx-image-grid-preview'
import { createMdxSpeakerDeckPreview } from '#components/mdx-speaker-deck-preview'
import { createBlockWidget } from '#editor/block-widget'
import {
  type BlockWidgetExclusionRange,
  isBlockWidgetExcluded,
} from '#editor/markdown-block-widget-exclusions'
import {
  imageData,
  type MarkdownSyntaxNode,
  selectionTouches,
} from '#editor/markdown-block-widget-utils'
import type { OgpFetcher } from '#lib/ogp-api'
import { analyzeImageGrids, pairImageGrids } from '#markdown/image-grid-pairs'

type BlockRange = Readonly<{ from: number; to: number }>

type ComponentTag = Readonly<{
  attributes: ReadonlyMap<string, string>
  closing: boolean
  name: string
  selfClosing: boolean
}>

type ImageGrid = Readonly<{
  closing: MarkdownSyntaxNode
  images: MarkdownSyntaxNode[]
  opening: MarkdownSyntaxNode
  range: BlockRange
  renderable: boolean
}>

type MdxSyntaxNodes = Readonly<{
  images: MarkdownSyntaxNode[]
  tags: MarkdownSyntaxNode[]
}>

interface MdxBlockWidgets {
  decorations: DecorationSet
  imageGridRanges: BlockRange[]
  ranges: BlockRange[]
}

function componentTag(state: EditorState, node: MarkdownSyntaxNode) {
  const source = state.doc.sliceString(node.from, node.to).trim()
  const match = /^<(\/)?([A-Z][A-Za-z0-9]*)([^>]*)>$/u.exec(source)
  if (!match) return null

  const closing = match[1] === '/'
  const name = match[2] ?? ''
  let rawAttributes = match[3] ?? ''
  const selfClosing = !closing && /\/\s*$/u.test(rawAttributes)
  if (selfClosing) rawAttributes = rawAttributes.replace(/\/\s*$/u, '')
  const attributes = parseAttributes(rawAttributes)
  if (attributes === null || (closing && attributes.size > 0)) return null

  return {
    attributes,
    closing,
    name,
    selfClosing,
  }
}

function parseAttributes(value: string): Map<string, string> | null {
  const attributes = new Map<string, string>()
  let position = 0

  while (position < value.length) {
    while (/\s/u.test(value[position] ?? '')) position += 1
    if (position === value.length) break

    const name = /^[A-Za-z][A-Za-z0-9:_-]*/u.exec(value.slice(position))?.[0]
    if (name === undefined || name.length === 0) return null
    position += name.length
    while (/\s/u.test(value[position] ?? '')) position += 1
    if (value[position] !== '=') return null
    position += 1
    while (/\s/u.test(value[position] ?? '')) position += 1

    const quote = value[position]
    if (quote !== '"' && quote !== "'") return null
    position += 1
    const valueStart = position
    while (position < value.length && value[position] !== quote) position += 1
    if (position === value.length || attributes.has(name)) return null

    attributes.set(name, value.slice(valueStart, position))
    position += 1
  }

  return attributes
}

function isTopLevelTag(state: EditorState, node: MarkdownSyntaxNode): boolean {
  return node.from === state.doc.lineAt(node.from).from
}

function hasOnlyAttribute(tag: ComponentTag, name: string): boolean {
  return tag.attributes.size === 1 && tag.attributes.has(name)
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
  const ranges: BlockWidgetExclusionRange[] = []
  const { images, tags } = collectMdxSyntaxNodes(state)
  const markdown = state.doc.toString()
  for (const grid of pairImageGrids(
    markdown,
    imageGridTagSources(markdown, tags),
    images,
  )) {
    ranges.push(
      ...grid.images.map((image) => ({ from: image.from, to: image.to })),
    )
  }
  return ranges
}

function collectMdxSyntaxNodes(state: EditorState): MdxSyntaxNodes {
  const tags: MarkdownSyntaxNode[] = []
  const images: MarkdownSyntaxNode[] = []
  const cursor = syntaxTree(state).cursor()
  while (cursor.next()) {
    if (cursor.name === 'MdxComponentTag') tags.push(cursor.node)
    if (cursor.name === 'Image') images.push(cursor.node)
  }
  return { images, tags }
}

function imageGridTagSources(
  markdown: string,
  tags: readonly MarkdownSyntaxNode[],
) {
  return tags.map((node) => ({
    from: node.from,
    to: node.to,
    source: markdown.slice(node.from, node.to),
    node,
  }))
}

function collectImageGrids(
  state: EditorState,
  tags: readonly MarkdownSyntaxNode[],
  images: readonly MarkdownSyntaxNode[],
): ImageGrid[] {
  const markdown = state.doc.toString()
  const tagSources = imageGridTagSources(markdown, tags)

  return analyzeImageGrids(markdown, tagSources, images).map(
    ({ opening, closing, images: gridImages, range, renderable }) => ({
      closing: closing.node,
      images: [...gridImages],
      opening: opening.node,
      range,
      renderable,
    }),
  )
}

export function buildMdxBlockWidgetDecorations(
  state: EditorState,
  exclusions: readonly BlockWidgetExclusionRange[],
  fetchOgp: OgpFetcher | undefined,
): MdxBlockWidgets {
  const { images, tags } = collectMdxSyntaxNodes(state)
  const decorations = []
  const ranges: BlockRange[] = []
  const grids = collectImageGrids(state, tags, images)
  const imageGridRanges = grids.map((grid) => grid.range)

  for (const grid of grids) {
    const { images: gridImages, range } = grid
    const imageExclusions = exclusions.filter(
      (excluded) =>
        !gridImages.some(
          (image) => excluded.from === image.from && excluded.to === image.to,
        ),
    )
    if (
      selectionTouches(state, range.from, range.to) ||
      isBlockWidgetExcluded(range, imageExclusions) ||
      !grid.renderable
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
    if (!tag || tag.closing || !tag.selfClosing || !isTopLevelTag(state, node))
      continue

    const range = { from: node.from, to: node.to }
    if (
      selectionTouches(state, range.from, range.to) ||
      isBlockWidgetExcluded(range, exclusions) ||
      imageGridRanges.some(
        (grid) => node.from >= grid.from && node.to <= grid.to,
      )
    )
      continue

    let widget: ReturnType<typeof createBlockWidget> | undefined
    const source = state.doc.sliceString(range.from, range.to)
    if (tag.name === 'CardLink') {
      const href = safeCardUrl(tag.attributes.get('href'))
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
      if (!hasOnlyAttribute(tag, 'id')) continue
      const id = tag.attributes.get('id')
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
