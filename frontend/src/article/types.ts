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
