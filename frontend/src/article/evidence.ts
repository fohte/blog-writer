import { err, ok, type Result } from 'neverthrow'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import { InvalidEvidenceError, SourceNotFoundError } from '#article/errors'
import type { MovePositionMapping } from '#article/move-block'
import type {
  Evidence,
  EvidenceData,
  EvidenceVerdict,
  EvidenceView,
} from '#article/types'

export type AddEvidenceInput = Omit<Evidence, 'from' | 'to'> & {
  from: number
  to: number
}

function getEvidenceMap(doc: Y.Doc): Y.Map<EvidenceData> {
  return doc.getMap('evidence')
}

export function observeEvidence(doc: Y.Doc, listener: () => void): () => void {
  const evidence = getEvidenceMap(doc)
  const sources = doc.getMap('sources')
  evidence.observeDeep(listener)
  sources.observeDeep(listener)
  return () => {
    evidence.unobserveDeep(listener)
    sources.unobserveDeep(listener)
  }
}

function readEvidence(id: string, data: EvidenceData): Evidence | undefined {
  const from = data.get('from')
  const to = data.get('to')
  const verdict = data.get('verdict')
  if (
    typeof from !== 'object' ||
    from === null ||
    typeof to !== 'object' ||
    to === null ||
    !isVerdict(verdict)
  )
    return undefined

  return {
    id,
    from: Y.createRelativePositionFromJSON(from),
    to: Y.createRelativePositionFromJSON(to),
    claim: asString(data.get('claim')),
    sourceId:
      data.get('sourceId') === null ? null : asString(data.get('sourceId')),
    quote: asString(data.get('quote')),
    verdict,
    checkedAt: asString(data.get('checkedAt')),
  }
}

function isVerdict(value: unknown): value is EvidenceVerdict {
  return (
    value === 'supported' ||
    value === 'insufficient' ||
    value === 'outdated' ||
    value === 'contradicted'
  )
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function resolveRange(
  doc: Y.Doc,
  evidence: Evidence,
): { from: number; to: number } | undefined {
  const body = getBody(doc)
  const from = Y.createAbsolutePositionFromRelativePosition(evidence.from, doc)
  const to = Y.createAbsolutePositionFromRelativePosition(evidence.to, doc)
  if (!from || !to || from.type !== body || to.type !== body) return undefined
  return { from: from.index, to: to.index }
}

function writeEvidenceAnchors(
  data: EvidenceData,
  body: Y.Text,
  from?: number,
  to?: number,
): void {
  if (from !== undefined)
    data.set(
      'from',
      Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(body, from, 1),
      ),
    )
  if (to !== undefined)
    data.set(
      'to',
      Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(body, to, -1),
      ),
    )
}

type EvidenceInspection =
  | { kind: 'visible'; from: number; view: EvidenceView }
  | { kind: 'hidden' }
  | { kind: 'prune' }

function inspectEvidence(
  doc: Y.Doc,
  id: string,
  data: EvidenceData,
  markdown: string,
  sources: Y.Map<unknown>,
): EvidenceInspection {
  const item = readEvidence(id, data)
  if (!item) return { kind: 'hidden' }
  if (item.sourceId !== null && !sources.has(item.sourceId))
    return { kind: 'prune' }
  const range = resolveRange(doc, item)
  if (!range) return { kind: 'hidden' }
  if (range.to === range.from) return { kind: 'prune' }
  if (range.to < range.from) return { kind: 'hidden' }
  const currentClaim = markdown.slice(range.from, range.to)
  return {
    kind: 'visible',
    from: range.from,
    view: { ...item, currentClaim, edited: currentClaim !== item.claim },
  }
}

export function addEvidence(
  doc: Y.Doc,
  input: AddEvidenceInput,
): Result<Evidence, SourceNotFoundError | InvalidEvidenceError> {
  if (input.sourceId !== null && !doc.getMap('sources').has(input.sourceId))
    return err(new SourceNotFoundError(input.sourceId))
  const body = getBody(doc)
  if (
    input.id.length === 0 ||
    input.claim.length === 0 ||
    input.from < 0 ||
    input.to <= input.from ||
    input.to > body.length
  )
    return err(new InvalidEvidenceError('Invalid evidence range'))
  const evidence = getEvidenceMap(doc)
  if (evidence.has(input.id))
    return err(new InvalidEvidenceError('Evidence already exists'))

  const data = new Y.Map<unknown>()
  writeEvidenceAnchors(data, body, input.from, input.to)
  data.set('claim', input.claim)
  data.set('sourceId', input.sourceId)
  data.set('quote', input.quote)
  data.set('verdict', input.verdict)
  data.set('checkedAt', input.checkedAt)
  evidence.set(input.id, data)
  const result = readEvidence(input.id, data)
  return result
    ? ok(result)
    : err(new InvalidEvidenceError('Evidence could not be read'))
}

export function listEvidence(doc: Y.Doc): EvidenceView[] {
  const evidence = getEvidenceMap(doc)
  if (evidence.size === 0) return []
  const markdown = getBody(doc).toJSON()
  const sources = doc.getMap('sources')
  const result: Extract<EvidenceInspection, { kind: 'visible' }>[] = []

  for (const [id, data] of evidence.entries()) {
    const inspection = inspectEvidence(doc, id, data, markdown, sources)
    if (inspection.kind === 'visible') result.push(inspection)
  }
  return result
    .sort((left, right) => left.from - right.from)
    .map(({ view }) => view)
}

export function pruneEvidence(doc: Y.Doc): void {
  const evidence = getEvidenceMap(doc)
  if (evidence.size === 0) return
  const markdown = getBody(doc).toJSON()
  const sources = doc.getMap('sources')
  for (const [id, data] of evidence.entries()) {
    if (inspectEvidence(doc, id, data, markdown, sources).kind === 'prune')
      evidence.delete(id)
  }
}

export function removeEvidence(doc: Y.Doc, id: string): void {
  getEvidenceMap(doc).delete(id)
}

export function prepareEvidenceAnchorMove(
  doc: Y.Doc,
  mapping: MovePositionMapping,
): () => void {
  const body = getBody(doc)
  const relocations: {
    data: EvidenceData
    from: number | undefined
    to: number | undefined
  }[] = []

  for (const data of getEvidenceMap(doc).values()) {
    const item = readEvidence('', data)
    if (!item) continue
    const range = resolveRange(doc, item)
    if (!range) continue
    relocations.push({
      data,
      from: mapping.mapPosition(range.from),
      to: mapping.mapRangeEnd(range.to),
    })
  }

  return () => {
    for (const { data, from, to } of relocations)
      writeEvidenceAnchors(data, body, from, to)
  }
}
