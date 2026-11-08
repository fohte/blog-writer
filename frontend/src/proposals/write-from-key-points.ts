import type { EditorView } from '@codemirror/view'
import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  type ResultAsync,
} from 'neverthrow'
import * as Y from 'yjs'

import { extractAtxHeadingText } from '#article/headings'
import {
  addEvidence,
  getPremise,
  listFindings,
  listSources,
  topLevelBlocks,
} from '#article/index'
import type { EvidenceVerdict } from '#article/types'
import type { SuggestionReplacementMark } from '#editor/suggestion-layer'
import { loadLlmSettings } from '#lib/llm-settings'
import { getBlankLineInsertionSeparators } from '#proposals/body-request-context'
import {
  requestWriteFromKeyPoints,
  type WriteFromKeyPointsRequest,
  type WrittenSentence,
} from '#proposals/write-from-key-points-api'

type Range = { from: number; to: number }

type AcceptedSentenceEvidence = {
  from: number
  to: number
  claim: string
  sourceId: string | null
  quote: string
  verdict: EvidenceVerdict
}

export type WriteFromKeyPointsMetadata = {
  sentences: AcceptedSentenceEvidence[]
}

export type WriteFromKeyPointsProposal = {
  replacement: string
  metadata: WriteFromKeyPointsMetadata
  replacementMarks: SuggestionReplacementMark[]
}

type WriteFromKeyPointsSelection = {
  context: { range: Range }
  instruction: string
  view: EditorView
}

type PointReference = {
  sourceId: string
  quote: string
}

type CandidatePoint = {
  sourceId: string
  id: string
  researchedHeading: string
  requestHeadingId: string
  text: string
  quote: string
  targetMatch: boolean
}

type RequestHeading = { id: string; text: string; from: number }

const maximumKeyPoints = 50

function isHeadingBlock(name: string): boolean {
  return name.startsWith('ATXHeading') || name.startsWith('SetextHeading')
}

function headingText(
  markdown: string,
  block: ReturnType<typeof topLevelBlocks>[number],
) {
  if (block.name.startsWith('ATXHeading')) {
    return extractAtxHeadingText(markdown, block.from, block.contentTo)
  }

  const blockMarkdown = markdown.slice(block.from, block.contentTo)
  const lineEnd = blockMarkdown.indexOf('\n')
  return blockMarkdown
    .slice(0, lineEnd === -1 ? blockMarkdown.length : lineEnd)
    .trim()
}

function requestBlocks(markdown: string) {
  const blocks = topLevelBlocks(markdown)
  return {
    blocks: blocks.map((block, index) => ({
      id: `block-${String(index)}`,
      kind: isHeadingBlock(block.name)
        ? 'heading'
        : block.name === 'Paragraph'
          ? 'paragraph'
          : 'other',
      markdown: markdown.slice(block.from, block.contentTo),
    })),
    headings: blocks.flatMap((block, index) =>
      isHeadingBlock(block.name)
        ? [
            {
              id: `block-${String(index)}`,
              text: headingText(markdown, block),
              from: block.from,
            },
          ]
        : [],
    ),
  }
}

function targetHeading(
  headings: RequestHeading[],
  range: Range,
): RequestHeading | undefined {
  const index = headings.findLastIndex(({ from }) => from <= range.from)
  return headings[index]
}

function requestSources(
  doc: Y.Doc,
  target: RequestHeading,
  headings: RequestHeading[],
): {
  sources: WriteFromKeyPointsRequest['sources']
  points: Map<string, PointReference>
} {
  const headingIdsByText = new Map<string, string[]>()
  for (const heading of headings) {
    const ids = headingIdsByText.get(heading.text) ?? []
    ids.push(heading.id)
    headingIdsByText.set(heading.text, ids)
  }
  const availableSources = new Map(
    listSources(doc)
      .filter((source) => source.status === 'ready')
      .map((source) => [source.id, source]),
  )
  const pointsBySource = new Map<string, CandidatePoint[]>()
  for (const finding of listFindings(doc)) {
    if (!availableSources.has(finding.sourceId)) continue
    const sourcePoints = pointsBySource.get(finding.sourceId) ?? []
    const researchedHeading = finding.researchedHeading ?? ''
    const matchingHeadingIds =
      researchedHeading.length === 0
        ? []
        : (headingIdsByText.get(researchedHeading) ?? [])
    sourcePoints.push({
      sourceId: finding.sourceId,
      id: finding.id,
      researchedHeading,
      requestHeadingId:
        matchingHeadingIds.find((id) => id === target.id) ??
        matchingHeadingIds[0] ??
        '',
      text: finding.text,
      quote: finding.quote,
      targetMatch: target.text.length > 0 && researchedHeading === target.text,
    })
    pointsBySource.set(finding.sourceId, sourcePoints)
  }

  const candidates = [...pointsBySource.values()].flat()
  candidates.sort(
    (left, right) => Number(right.targetMatch) - Number(left.targetMatch),
  )
  const selected = new Set(
    candidates.slice(0, maximumKeyPoints).map(({ id }) => id),
  )
  const points = new Map<string, PointReference>(
    candidates
      .filter(({ id }) => selected.has(id))
      .map(({ id, sourceId, quote }) => [id, { sourceId, quote }]),
  )

  return {
    sources: [...availableSources.values()].flatMap((source) => {
      const keyPoints = (pointsBySource.get(source.id) ?? [])
        .filter(({ id }) => selected.has(id))
        .sort(
          (left, right) => Number(right.targetMatch) - Number(left.targetMatch),
        )
        .map((point) => ({
          id: point.id,
          researched_heading_id: point.requestHeadingId,
          text: point.text,
          quote: point.quote.length === 0 ? null : point.quote,
        }))
      if (keyPoints.length === 0) return []
      return [
        {
          title: source.title,
          url: source.url,
          fetched_at: source.checkedAt ?? '',
          summary: source.summary,
          key_points: keyPoints,
        },
      ]
    }),
    points,
  }
}

function buildProposal(
  sentences: WrittenSentence[],
  points: Map<string, PointReference>,
  markdown: string,
  range: Range,
): WriteFromKeyPointsProposal | undefined {
  const written = sentences.filter(({ text }) => text.trim().length > 0)
  if (written.length === 0) return undefined

  const baseReplacement = written.map(({ text }) => text).join(' ')
  const separators =
    range.from === range.to
      ? getBlankLineInsertionSeparators(
          markdown.slice(0, range.from),
          markdown.slice(range.to),
          baseReplacement,
        )
      : { before: '', after: '' }
  const replacement = `${separators.before}${baseReplacement}${separators.after}`
  const prefixLength = separators.before.length
  const metadata: WriteFromKeyPointsMetadata = { sentences: [] }
  const replacementMarks: SuggestionReplacementMark[] = []
  let from = prefixLength

  for (const sentence of written) {
    const to = from + sentence.text.length
    if (sentence.is_factual) {
      const point = sentence.key_point_ids
        .map((id) => points.get(id))
        .find((candidate) => candidate !== undefined)
      const verdict = point ? 'supported' : 'insufficient'
      metadata.sentences.push({
        from,
        to,
        claim: sentence.text,
        sourceId: point?.sourceId ?? null,
        quote: point?.quote ?? '',
        verdict,
      })
      replacementMarks.push({ from, to, verdict })
    }
    from = to + 1
  }

  return { replacement, metadata, replacementMarks }
}

export function hasKeyPoints(doc: Y.Doc): boolean {
  const readySourceIds = new Set(
    listSources(doc)
      .filter((source) => source.status === 'ready')
      .map((source) => source.id),
  )
  return listFindings(doc).some(({ sourceId }) => readySourceIds.has(sourceId))
}

export function writeFromKeyPoints(
  doc: Y.Doc,
  selection: WriteFromKeyPointsSelection,
  signal: AbortSignal,
): ResultAsync<WriteFromKeyPointsProposal, Error> {
  const markdown = selection.view.state.doc.toString()
  const { blocks, headings } = requestBlocks(markdown)
  const target = targetHeading(headings, selection.context.range)
  if (target === undefined) {
    return errAsync(new Error('対象の見出しを特定できませんでした。'))
  }
  const premise = getPremise(doc)
  const { sources, points } = requestSources(doc, target, headings)
  const body: WriteFromKeyPointsRequest = {
    premise: {
      audience: premise.audience ?? '',
      purpose: premise.purpose ?? '',
      thesis: premise.claim ?? '',
    },
    target_heading_id: target.id,
    blocks,
    sources,
  }

  const settings = loadLlmSettings(() => window.localStorage)
  return settings.match(
    (value) =>
      requestWriteFromKeyPoints(fetch, value, body, signal).andThen(
        (result) => {
          const proposal = buildProposal(
            result.sentences,
            points,
            markdown,
            selection.context.range,
          )
          return proposal
            ? okAsync(proposal)
            : errAsync(new Error('文章の提案を作成できませんでした。'))
        },
      ),
    (cause) => errAsync(cause),
  )
}

export function persistAcceptedEvidence(
  doc: Y.Doc,
  metadata: WriteFromKeyPointsMetadata | undefined,
  acceptedRange: { current(): Range | undefined; dispose(): void } | undefined,
): Result<void, Error> {
  if (!acceptedRange) return ok(undefined)
  const range = acceptedRange.current()
  acceptedRange.dispose()
  if (!metadata || !range) return ok(undefined)

  let error: Error | undefined
  doc.transact(() => {
    for (const sentence of metadata.sentences) {
      const sourceExists =
        sentence.sourceId === null ||
        doc.getMap('sources').has(sentence.sourceId)
      const saved = addEvidence(doc, {
        id: crypto.randomUUID(),
        from: range.from + sentence.from,
        to: range.from + sentence.to,
        claim: sentence.claim,
        sourceId: sourceExists ? sentence.sourceId : null,
        quote: sourceExists ? sentence.quote : '',
        verdict: sourceExists ? sentence.verdict : 'insufficient',
        checkedAt: new Date().toISOString(),
      })
      saved.match(
        () => undefined,
        (cause) => {
          error ??= cause
        },
      )
    }
  })

  return error ? err(error) : ok(undefined)
}
