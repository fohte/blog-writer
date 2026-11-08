import { describe, expect, it, vi } from 'vitest'

import { mountMarkdownEditor } from '#editor/__tests__/markdown-editor-setup.test'

function readPreviewOutput(
  content: HTMLElement | null,
  body: { toJSON(): string },
) {
  const figure = content?.querySelector('figure') ?? null
  const alert = figure?.querySelector<HTMLElement>('[role="alert"]') ?? null
  return {
    body: body.toJSON(),
    errorShown: alert !== null && alert.textContent.trim().length > 0,
    previewCount: content?.querySelectorAll('figure').length ?? 0,
    source: figure?.querySelector('pre code')?.textContent ?? null,
    svgRendered: figure !== null && figure.querySelector('svg') !== null,
    temporaryNodeIds: [
      ...document.querySelectorAll<HTMLElement>('[id^="dmarkdown-mermaid-"]'),
    ].map((element) => element.id),
  }
}

describe('Mermaid previews in MarkdownEditor', () => {
  it('renders a valid Mermaid diagram from the editor source', async () => {
    const markdown = '```mermaid\ngraph LR\n  Alpha --> Beta\n```'
    const { body, content } = mountMarkdownEditor(markdown)
    const output = await vi.waitUntil(() => {
      const result = readPreviewOutput(content, body)
      return result.svgRendered ? result : undefined
    })

    expect(output).toEqual({
      body: markdown,
      errorShown: false,
      previewCount: 1,
      source: null,
      svgRendered: true,
      temporaryNodeIds: [],
    })
  })

  it('shows the source and parser error without leaving Mermaid DOM behind', async () => {
    const source = 'graph LR\n  Alpha -->'
    const markdown = ['```mermaid', source, '```'].join('\n')
    const { body, content } = mountMarkdownEditor(markdown)
    const output = await vi.waitUntil(() => {
      const result = readPreviewOutput(content, body)
      return result.errorShown ? result : undefined
    })

    expect(output).toEqual({
      body: markdown,
      errorShown: true,
      previewCount: 1,
      source,
      svgRendered: false,
      temporaryNodeIds: [],
    })
  })
})
