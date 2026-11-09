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
const imageSource =
  '![Sample](https://assets.example.test/images/sample.webp?w=640&h=360)'
const mermaidSource = '```mermaid\ngraph LR\n  Draft --> Preview\n```'

function hasEditorSource(content: HTMLElement, source: string): boolean {
  const visibleText = [...content.querySelectorAll<HTMLElement>('.cm-line')]
    .map((line) => line.textContent)
    .join('')
  return visibleText.includes(source.replaceAll('\n', ''))
}

describe('move conflict previews and block widgets', () => {
  it.each([
    { block: 'table', markdown: tableSource, text: 'Tables' },
    { block: 'image', markdown: imageSource, text: 'Sample' },
    { block: 'Mermaid diagram', markdown: mermaidSource, text: 'Draft' },
  ])(
    'keeps a move conflict visible over a $block instead of replacing its source',
    async ({ block, markdown, text }) => {
      const source = `before\n\n${markdown}\n\nafter`
      const from = source.indexOf(text)
      moveConflictState.conflicts = [
        {
          id: `conflict-${block}`,
          from,
          to: from + text.length,
          text,
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
        sourceVisible: hasEditorSource(content, markdown),
        renderedPreviewCount: content.querySelectorAll('table, figure').length,
      })
      expect(readOutput()).toEqual({
        body: source,
        conflictText: text,
        notice:
          text +
          'この文は、移動前のセクションに書き足されたものです。移動先へ移すその場に残す',
        sourceVisible: true,
        renderedPreviewCount: 0,
      })
    },
  )
})
