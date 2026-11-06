import { Facet } from '@codemirror/state'
import * as Y from 'yjs'

export const undoManagerFacet = Facet.define<
  Y.UndoManager,
  Y.UndoManager | null
>({
  combine: (undoManagers) => undoManagers[0] ?? null,
})
