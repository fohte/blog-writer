import { describe, expect, it } from 'vitest'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'

describe('block previews inside an unrenderable ImageGrid', () => {
  it('keeps tables and Mermaid source visible without replacing either block', () => {
    const source = [
      '<ImageGrid>',
      '| Feature | Status |',
      '| --- | --- |',
      '| Preview | Ready |',
      '',
      '```mermaid',
      'graph TD',
      '  Source --> Preview',
      '```',
      '</ImageGrid>',
    ].join('\n')
    const { body, content } = mountMarkdownEditor(source)

    const readOutput = () => ({
      body: body.toJSON(),
      blockWidgets: [
        ...(content?.querySelectorAll('.cm-markdown-block-widget') ?? []),
      ].map((widget) => widget.textContent),
      editorLines: [
        ...(content?.querySelectorAll<HTMLElement>('.cm-line') ?? []),
      ].map((line) => line.textContent),
    })
    expect(readOutput()).toEqual({
      body: source,
      blockWidgets: [],
      editorLines: source.split('\n'),
    })
  })
})
