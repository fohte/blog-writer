import type * as Y from 'yjs'

export type PremiseField = 'audience' | 'purpose' | 'claim'

export type Premise = Record<PremiseField, string | null>

export type MemoState =
  | { kind: 'unorganized' }
  | { kind: 'dismissed' }
  | { kind: 'adopted'; heading: Heading }

export type Memo = {
  id: string
  text: string
  order: number
  state: MemoState
}

export type Heading = {
  level: number
  text: string
  from: number
  to: number
  children: Heading[]
}

export type MemoData = Y.Map<unknown>

export type SourceKind = 'url' | 'file' | 'pasted'

export type SourceStatus =
  'ready' | 'unavailable' | 'loginRequired' | 'analysisFailed'

export type Source = {
  id: string
  kind: SourceKind
  title: string
  url: string | null
  fileName: string | null
  checkedAt: string | null
  /** Calendar date (`YYYY-MM-DD`) the page says it was published. */
  publishedAt: string | null
  status: SourceStatus
  summary: string
  /** ISO time the source was added, or null for a source saved before this was recorded. */
  addedAt: string | null
}

export type Finding = {
  id: string
  sourceId: string
  researchedHeading?: string
  text: string
  quote: string
}

export type SourceData = Y.Map<unknown>
export type FindingData = Y.Map<unknown>

export type EvidenceVerdict =
  'supported' | 'insufficient' | 'outdated' | 'contradicted'

export type Evidence = {
  id: string
  from: Y.RelativePosition
  to: Y.RelativePosition
  claim: string
  sourceId: string | null
  quote: string
  verdict: EvidenceVerdict
  checkedAt: string
}

export type EvidenceView = Evidence & {
  currentClaim: string
  edited: boolean
}

export type EvidenceData = Y.Map<unknown>
