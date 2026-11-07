import { err, ok, type Result } from 'neverthrow'
import * as Y from 'yjs'

import {
  InvalidSourceError,
  SourceAlreadyExistsError,
  SourceNotFoundError,
} from '#article/errors'
import type {
  Finding,
  FindingData,
  Source,
  SourceData,
  SourceKind,
  SourceStatus,
} from '#article/types'

export type AddSourceInput = Omit<Source, 'status' | 'summary'> & {
  status?: SourceStatus
  summary?: string
}

export type AddFindingInput = Omit<
  Finding,
  'id' | 'sourceId' | 'researchedHeadingId'
> & { id?: string; researchedHeadingId?: string | null }

function getSourcesMap(doc: Y.Doc): Y.Map<SourceData> {
  return doc.getMap('sources')
}

function getFindingsMap(doc: Y.Doc): Y.Map<FindingData> {
  return doc.getMap('findings')
}

export function observeSources(doc: Y.Doc, listener: () => void): () => void {
  const sources = getSourcesMap(doc)
  const findings = getFindingsMap(doc)
  sources.observeDeep(listener)
  findings.observeDeep(listener)

  return () => {
    sources.unobserveDeep(listener)
    findings.unobserveDeep(listener)
  }
}

function readSource(id: string, source: SourceData): Source {
  const value = (key: string): unknown => source.get(key)
  const kind = value('kind')
  const status = value('status')
  return {
    id,
    kind: isSourceKind(kind) ? kind : 'url',
    title: asString(value('title')),
    url: asNullableString(value('url')),
    fileName: asNullableString(value('fileName')),
    checkedAt: asNullableString(value('checkedAt')),
    status:
      status === 'unavailable' || status === 'analysisFailed'
        ? status
        : 'ready',
    summary: asString(value('summary')),
  }
}

function readFinding(id: string, finding: FindingData): Finding {
  const researchedHeadingId = asNullableString(
    finding.get('researchedHeadingId'),
  )
  return {
    id,
    sourceId: asString(finding.get('sourceId')),
    ...(researchedHeadingId === null ? {} : { researchedHeadingId }),
    text: asString(finding.get('text')),
    quote: asString(finding.get('quote')),
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isSourceKind(value: unknown): value is SourceKind {
  return value === 'url' || value === 'file' || value === 'pasted'
}

export function listSources(doc: Y.Doc): Source[] {
  return [...getSourcesMap(doc).entries()]
    .map(([id, source]) => readSource(id, source))
    .sort((left, right) => left.title.localeCompare(right.title))
}

export function listFindings(doc: Y.Doc, sourceId?: string): Finding[] {
  return [...getFindingsMap(doc).entries()]
    .map(([id, finding]) => readFinding(id, finding))
    .filter(
      (finding) => sourceId === undefined || finding.sourceId === sourceId,
    )
}

export function addSource(
  doc: Y.Doc,
  input: AddSourceInput,
): Result<Source, InvalidSourceError | SourceAlreadyExistsError> {
  if (input.id.length === 0 || input.title.trim().length === 0) {
    return err(new InvalidSourceError('Source ID and title must not be empty'))
  }
  const sources = getSourcesMap(doc)
  if (sources.has(input.id)) return err(new SourceAlreadyExistsError(input.id))

  const source = new Y.Map<unknown>()
  source.set('kind', input.kind)
  source.set('title', input.title)
  source.set('url', input.url)
  source.set('fileName', input.fileName)
  source.set('checkedAt', input.checkedAt)
  source.set('status', input.status ?? 'ready')
  source.set('summary', input.summary ?? '')
  sources.set(input.id, source)
  return ok(readSource(input.id, source))
}

export function updateSource(
  doc: Y.Doc,
  id: string,
  update: Partial<Omit<Source, 'id'>>,
): Result<Source, SourceNotFoundError> {
  const source = getSourcesMap(doc).get(id)
  if (!source) return err(new SourceNotFoundError(id))
  for (const [key, value] of Object.entries(update)) source.set(key, value)
  return ok(readSource(id, source))
}

export function setFindings(
  doc: Y.Doc,
  sourceId: string,
  findings: AddFindingInput[],
): Result<Finding[], SourceNotFoundError | InvalidSourceError> {
  if (!getSourcesMap(doc).has(sourceId))
    return err(new SourceNotFoundError(sourceId))
  const normalized = findings.map((finding, index) => ({
    ...finding,
    id: finding.id ?? `${sourceId}-${index.toString()}`,
  }))
  if (normalized.some((finding) => finding.id.length === 0)) {
    return err(new InvalidSourceError('Finding ID must not be empty'))
  }

  const findingMap = getFindingsMap(doc)
  for (const [id, current] of findingMap.entries()) {
    if (current.get('sourceId') === sourceId) findingMap.delete(id)
  }
  const result: Finding[] = []
  for (const finding of normalized) {
    const data = new Y.Map<unknown>()
    data.set('sourceId', sourceId)
    if (finding.researchedHeadingId != null) {
      data.set('researchedHeadingId', finding.researchedHeadingId)
    }
    data.set('text', finding.text)
    data.set('quote', finding.quote)
    findingMap.set(finding.id, data)
    result.push(readFinding(finding.id, data))
  }
  return ok(result)
}

export function deleteSource(
  doc: Y.Doc,
  id: string,
): Result<void, SourceNotFoundError> {
  const sources = getSourcesMap(doc)
  if (!sources.has(id)) return err(new SourceNotFoundError(id))
  doc.transact(() => {
    sources.delete(id)
    const findings = getFindingsMap(doc)
    for (const [findingId, finding] of findings.entries()) {
      if (finding.get('sourceId') === id) findings.delete(findingId)
    }
    const evidence = doc.getMap<Y.Map<unknown>>('evidence')
    for (const [evidenceId, item] of evidence.entries()) {
      if (item.get('sourceId') === id) evidence.delete(evidenceId)
    }
  })
  return ok()
}
