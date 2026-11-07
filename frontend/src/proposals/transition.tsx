import type { Extension } from '@codemirror/state'
import { Transaction } from '@codemirror/state'
import {
  EditorView,
  ViewPlugin as CodeMirrorViewPlugin,
} from '@codemirror/view'
import type * as Y from 'yjs'

import type { BlockMoved } from '#article/index'
import { blockMoved, getPremise, topLevelBlocks } from '#article/index'
import {
  createSuggestionLayer,
  type InFlightSuggestion,
  type SuggestionPosition,
  type TextSuggestion,
} from '#editor/suggestion-layer'
import type { components } from '#lib/api/schema.gen.d.ts'
import { isRecord } from '#lib/guards'
import { type LlmSettings, loadLlmSettings } from '#lib/llm-settings'
import { postLlmResult } from '#lib/llm-sse'
import type { MoveHistory } from '#outline/index'

type TransitionRequest = components['schemas']['TransitionRequest']
type TransitionResponse = components['schemas']['TransitionResponse']
type TransitionSeam = TransitionRequest['seams'][number]

type ArticleContext = {
  doc: Y.Doc
  history: MoveHistory
}

type TextBlock = {
  id: string
  from: number
  contentTo: number
  kind: 'heading' | 'paragraph' | 'other'
  markdown: string
}

type PendingSeam = {
  seam: TransitionSeam
  from: number
  to: number
}

type Runtime = {
  layer: ReturnType<typeof createSuggestionLayer>
  pending: PendingSeam[]
  abortController: AbortController | null
  view: EditorView | null
  extensions: Extension[]
}

const runtimes = new WeakMap<Y.Doc, Runtime>()

function clearLayer(runtime: Runtime): void {
  runtime.layer.setInFlight(null).match(
    () => undefined,
    () => undefined,
  )
  runtime.layer.setSuggestions([]).match(
    () => undefined,
    () => undefined,
  )
}

function setInFlight(
  runtime: Runtime,
  position: InFlightSuggestion | null,
): void {
  runtime.layer.setInFlight(position).match(
    () => undefined,
    () => undefined,
  )
}

function setSuggestions(
  runtime: Runtime,
  suggestions: readonly TextSuggestion[],
): void {
  runtime.layer.setSuggestions(suggestions).match(
    () => undefined,
    () => undefined,
  )
}

function makeRuntime({ doc }: ArticleContext): Runtime {
  const existing = runtimes.get(doc)
  if (existing) return existing

  const runtime: Runtime = {
    layer: createSuggestionLayer({
      display: 'seam',
      onCancelInFlight: () => {
        runtime.abortController?.abort()
        runtime.abortController = null
        runtime.pending = []
      },
    }),
    pending: [],
    abortController: null,
    view: null,
    extensions: [],
  }
  runtime.extensions = [
    runtime.layer.extension,
    createViewExtension(runtime, doc),
  ]
  runtimes.set(doc, runtime)
  return runtime
}

function createViewExtension(runtime: Runtime, doc: Y.Doc): Extension {
  return [
    EditorView.updateListener.of((update) => {
      let move:
        { marker: BlockMoved; newDoc: typeof update.state.doc } | undefined
      for (const transaction of update.transactions) {
        if (transaction.docChanged) mapPendingRanges(runtime, transaction)
        const marker = transaction.annotation(blockMoved)
        if (
          marker !== undefined &&
          !transaction.isUserEvent('undo') &&
          !transaction.isUserEvent('redo')
        ) {
          move = { marker, newDoc: transaction.newDoc }
        }
      }
      if (!move) return

      const { marker, newDoc } = move
      const markdown = newDoc.toString()
      queueMicrotask(() => {
        if (runtime.view?.state.doc !== newDoc) return
        startProposal(runtime, doc, markdown, marker)
      })
    }),
    CodeMirrorViewPlugin.define((view) => {
      runtime.view = view
      return {
        destroy: () => {
          if (runtime.view === view) runtime.view = null
          runtime.abortController?.abort()
          runtime.abortController = null
          runtime.pending = []
          runtimes.delete(doc)
        },
      }
    }),
  ]
}

function blockList(markdown: string): TextBlock[] {
  return topLevelBlocks(markdown).map((block, index) => {
    const kind = /^ATXHeading|^SetextHeading/u.test(block.name)
      ? 'heading'
      : block.name === 'Paragraph'
        ? 'paragraph'
        : 'other'
    return {
      id: `block-${String(index)}`,
      from: block.from,
      contentTo: block.contentTo,
      kind,
      markdown: markdown.slice(block.from, block.contentTo),
    }
  })
}

function lastSentence(block: TextBlock): SuggestionPosition | undefined {
  return sentenceRange(block, 'last')
}

function firstSentence(block: TextBlock): SuggestionPosition | undefined {
  return sentenceRange(block, 'first')
}

function sentenceRange(
  block: TextBlock,
  side: 'first' | 'last',
): SuggestionPosition | undefined {
  if (block.kind !== 'paragraph') return undefined
  const endings = [
    ...block.markdown.matchAll(
      /[。！？]+["'”’）】」』]*|[.!?]+["'”’）】」』]*(?=\s|$)/gu,
    ),
  ]
  const nonWhitespace = block.markdown.search(/\S/u)
  if (nonWhitespace === -1) return undefined

  const selected = side === 'first' ? endings[0] : endings.at(-1)
  const previous = side === 'last' ? endings.at(-2) : undefined
  const lastEnding = endings.at(-1)
  const lastEndingEnd = (lastEnding?.index ?? 0) + (lastEnding?.[0].length ?? 0)
  const trailingText = block.markdown.slice(lastEndingEnd)
  const trailingStart = trailingText.search(/\S/u)
  const hasUnterminatedLastSentence = side === 'last' && trailingStart !== -1
  let from = hasUnterminatedLastSentence
    ? block.from + lastEndingEnd + trailingStart
    : block.from +
      (previous ? previous.index + previous[0].length : nonWhitespace)
  const selectedStart = selected?.index ?? 0
  const end = hasUnterminatedLastSentence
    ? block.markdown.trimEnd().length
    : selected
      ? selectedStart + selected[0].length
      : block.markdown.trimEnd().length
  while (/\s/u.test(block.markdown[from - block.from] ?? '')) from += 1
  const to = block.from + end
  return from < to ? { from, to } : undefined
}

function blockPairAt(
  blocks: TextBlock[],
  position: number,
): [TextBlock, TextBlock] | undefined {
  if (
    blocks.some((block) => block.from < position && position < block.contentTo)
  )
    return undefined

  let beforeIndex = -1
  for (const [index, block] of blocks.entries()) {
    if (block.contentTo <= position && block.from < position)
      beforeIndex = index
  }
  const afterIndex = blocks.findIndex((block) => block.from >= position)
  const findParagraph = (start: number, direction: -1 | 1) => {
    for (
      let index = start;
      index >= 0 && index < blocks.length;
      index += direction
    ) {
      const block = blocks[index]
      if (!block) return undefined
      if (block.kind === 'paragraph') return block
      if (block.kind !== 'heading') return undefined
    }
    return undefined
  }
  const before = findParagraph(beforeIndex, -1)
  const after = findParagraph(afterIndex, 1)
  return before && after ? [before, after] : undefined
}

function seamsAtMove(markdown: string, marker: BlockMoved): TransitionSeam[] {
  const blocks = blockList(markdown)
  const positions = [marker.from, marker.to, marker.seam]
  const seen = new Set<string>()

  return positions.flatMap((position, index) => {
    const pair = blockPairAt(blocks, position)
    if (!pair) return []
    const [before, after] = pair
    const left = lastSentence(before)
    const right = firstSentence(after)
    if (!left || !right) return []

    const id = `seam-${String(index)}`
    const key = `${String(left.from)}:${String(right.to)}`
    if (seen.has(key)) return []
    seen.add(key)
    return [
      {
        id,
        from: left.from,
        to: right.to,
        before_sentence: markdown.slice(left.from, left.to),
        middle: markdown.slice(left.to, right.from),
        after_sentence: markdown.slice(right.from, right.to),
        before_block_id: before.id,
        after_block_id: after.id,
      },
    ]
  })
}

function mapPendingRanges(runtime: Runtime, transaction: Transaction): void {
  if (!runtime.pending.length) return
  const changedRanges: Array<[number, number]> = []
  transaction.changes.iterChangedRanges((from, to) => {
    changedRanges.push([from, to])
  })
  runtime.pending = runtime.pending.flatMap((pending) => {
    if (changedRanges.some(([from, to]) => touches(pending, from, to)))
      return []
    return [
      {
        ...pending,
        from: transaction.changes.mapPos(pending.from, 1),
        to: transaction.changes.mapPos(pending.to, -1),
      },
    ]
  })
}

function touches(range: SuggestionPosition, from: number, to: number): boolean {
  if (from === to) {
    return range.from === range.to
      ? from === range.from
      : from > range.from && from < range.to
  }
  if (range.from === range.to) return from < range.from && to > range.from
  return from < range.to && to > range.from
}

function transitionApiUrl(settings: LlmSettings): string {
  if (settings.route === 'server') return '/api/proposals/transition'
  return `${settings.bridgeUrl.replace(/\/+$/u, '')}/api/proposals/transition`
}

function isTransitionResponse(value: unknown): value is TransitionResponse {
  return (
    isRecord(value) &&
    Array.isArray(value['suggestions']) &&
    value['suggestions'].every(
      (suggestion) =>
        isRecord(suggestion) &&
        typeof suggestion['seam_id'] === 'string' &&
        typeof suggestion['from'] === 'number' &&
        typeof suggestion['to'] === 'number' &&
        typeof suggestion['replacement'] === 'string',
    )
  )
}

function startProposal(
  runtime: Runtime,
  doc: Y.Doc,
  markdown: string,
  marker: BlockMoved,
): void {
  const view = runtime.view
  if (!view) return
  runtime.abortController?.abort()
  runtime.abortController = null
  runtime.pending = []
  clearLayer(runtime)

  const seams = seamsAtMove(markdown, marker).filter(
    ({ from, to }) => !runtime.layer.overlapsOtherLayer({ from, to }),
  )
  if (seams.length === 0) return
  const settings = loadLlmSettings(() => window.localStorage).match(
    (value) => value,
    () => undefined,
  )
  if (!settings || (settings.route === 'local' && !settings.bridgeUrl.trim()))
    return

  const blocks = blockList(markdown)
  const premise = getPremise(doc)
  const request: TransitionRequest = {
    premise: {
      audience: premise.audience ?? '',
      purpose: premise.purpose ?? '',
      thesis: premise.claim ?? '',
    },
    blocks: blocks.map(({ id, kind, markdown: content }) => ({
      id,
      kind,
      markdown: content,
    })),
    seams,
  }
  runtime.pending = seams.map((seam) => ({
    seam,
    from: seam.from,
    to: seam.to,
  }))
  const firstSeam = seams[0]
  if (!firstSeam) return
  setInFlight(runtime, {
    from: firstSeam.from,
    to: firstSeam.to,
    label: 'つなぎの文',
  })

  const abortController = new AbortController()
  runtime.abortController = abortController
  void postLlmResult<TransitionRequest, TransitionResponse>({
    url: transitionApiUrl(settings),
    body: request,
    signal: abortController.signal,
    isResult: isTransitionResponse,
  }).match(
    (result) => {
      if (runtime.abortController !== abortController) return
      const pendingById = new Map(
        runtime.pending.map((pending) => [pending.seam.id, pending]),
      )
      const proposals: TextSuggestion[] = result.suggestions
        .flatMap((suggestion) => {
          const pending = pendingById.get(suggestion.seam_id)
          if (
            !pending ||
            pending.seam.from !== suggestion.from ||
            pending.seam.to !== suggestion.to ||
            runtime.layer.overlapsOtherLayer(pending)
          )
            return []
          return [
            {
              id: `transition-${suggestion.seam_id}`,
              from: pending.from,
              to: pending.to,
              replacement: suggestion.replacement,
            },
          ]
        })
        .sort((left, right) => left.from - right.from || left.to - right.to)
      const nonOverlappingProposals: TextSuggestion[] = []
      for (const proposal of proposals) {
        const previous = nonOverlappingProposals.at(-1)
        if (previous && previous.to > proposal.from) continue
        nonOverlappingProposals.push(proposal)
      }
      runtime.abortController = null
      runtime.pending = []
      setInFlight(runtime, null)
      setSuggestions(runtime, nonOverlappingProposals)
    },
    () => {
      if (runtime.abortController !== abortController) return
      runtime.abortController = null
      runtime.pending = []
      // A later move retries silently without changing the article.
      setInFlight(runtime, null)
    },
  )
}

export function transitionProposalEditorExtensions(
  context: ArticleContext,
): Extension[] {
  return makeRuntime(context).extensions
}
