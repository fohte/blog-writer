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

export type SourceStatus = 'ready' | 'unavailable'

export type Source = {
  id: string
  kind: SourceKind
  title: string
  url: string | null
  fileName: string | null
  checkedAt: string | null
  status: SourceStatus
  summary: string
}

export type Finding = {
  id: string
  sourceId: string
  text: string
  quote: string
}

export type SourceData = Y.Map<unknown>
export type FindingData = Y.Map<unknown>
