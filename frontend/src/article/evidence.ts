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
    sourceId: asString(data.get('sourceId')),
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

export function addEvidence(
  doc: Y.Doc,
  input: AddEvidenceInput,
): Result<Evidence, SourceNotFoundError | InvalidEvidenceError> {
  if (!doc.getMap('sources').has(input.sourceId))
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
  data.set(
    'from',
    Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(body, input.from, 1),
    ),
  )
  data.set(
    'to',
    Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(body, input.to, -1),
    ),
  )
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
  const body = getBody(doc)
  const markdown = body.toJSON()
  const evidence = getEvidenceMap(doc)
  const sources = doc.getMap('sources')
  const result: EvidenceView[] = []

  for (const [id, data] of evidence.entries()) {
    const item = readEvidence(id, data)
    if (!item) {
      evidence.delete(id)
      continue
    }
    const range = resolveRange(doc, item)
    if (!sources.has(item.sourceId) || !range) {
      evidence.delete(id)
      continue
    }
    if (range.to < range.from) continue
    if (range.to === range.from) {
      evidence.delete(id)
      continue
    }
    const currentClaim = markdown.slice(range.from, range.to)
    result.push({ ...item, currentClaim, edited: currentClaim !== item.claim })
  }
  return result.sort((left, right) => {
    const leftRange = resolveRange(doc, left)
    const rightRange = resolveRange(doc, right)
    return (leftRange?.from ?? 0) - (rightRange?.from ?? 0)
  })
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
      to: mapping.mapPosition(range.to),
    })
  }

  return () => {
    for (const { data, from, to } of relocations) {
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
  }
}
