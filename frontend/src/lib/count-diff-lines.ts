import { Chunk } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'

/** Splits and chunks the text the way the merge view does, so the totals match the diff on screen. */
export function countDiffLines(original: string, modified: string) {
  const a = EditorState.create({ doc: original }).doc
  const b = EditorState.create({ doc: modified }).doc
  let added = 0
  let removed = 0
  for (const chunk of Chunk.build(a, b)) {
    if (chunk.toA > chunk.fromA)
      removed += a.lineAt(chunk.endA).number - a.lineAt(chunk.fromA).number + 1
    if (chunk.toB > chunk.fromB)
      added += b.lineAt(chunk.endB).number - b.lineAt(chunk.fromB).number + 1
  }
  return { added, removed }
}
