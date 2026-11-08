import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'
import { markdownBlockWidgets } from '#editor/markdown-block-widgets'
import { moveConflictExtension } from '#editor/move-conflict-extension'

const moveConflictState = vi.hoisted(() => ({
  conflicts: [] as Array<{
    id: string
    from: number
    to: number
    text: string
    target: number
  }>,
}))

vi.mock('#article/move-conflicts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#article/move-conflicts')>()
  return {
    ...actual,
    getMoveConflicts: () => moveConflictState.conflicts,
  }
})

const tableSource = [
  '| Feature | Offline |',
  '| :--- | ---: |',
  '| Tables | Yes |',
].join('\n')

describe('move conflict previews and block widgets', () => {
  it('keeps a conflict marker visible over a table instead of replacing its source', async () => {
    const source = `before\n\n${tableSource}\n\nafter`
    const from = source.indexOf('Tables')
    moveConflictState.conflicts = [
      {
        id: 'conflict-table-cell',
        from,
        to: from + 'Tables'.length,
        text: 'Tables',
        target: from,
      },
    ]
    const { body, content } = mountMarkdownEditor(
      source,
      [markdownBlockWidgets],
      (doc) => [moveConflictExtension(doc)],
      { initialSelection: { anchor: 0 } },
    )
    if (!content) throw new Error('The Markdown editor did not mount')
    await act(async () => {
      await vi.waitUntil(
        () => content.querySelector('[role="status"]') !== null,
      )
    })

    const readOutput = () => ({
      body: body.toJSON(),
      conflictText:
        content.querySelector('.cm-move-conflict-range')?.textContent ?? null,
      notice: content.querySelector('[role="status"]')?.textContent ?? null,
      renderedTableCount: content.querySelectorAll('table').length,
    })
    expect(readOutput()).toEqual({
      body: source,
      conflictText: 'Tables',
      notice:
        'Tablesこの文は、移動前のセクションに書き足されたものです。移動先へ移すその場に残す',
      renderedTableCount: 0,
    })
  })
})
