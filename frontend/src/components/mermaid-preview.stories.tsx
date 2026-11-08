import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useRef } from 'react'

import {
  createMermaidPreviewElement,
  type MermaidPreviewProps,
} from '#components/mermaid-preview'

function MermaidPreviewStory(props: MermaidPreviewProps) {
  const container = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (container.current)
      container.current.replaceChildren(createMermaidPreviewElement(props))
  }, [props])

  return <div ref={container} />
}

const meta = {
  title: 'Editor/MermaidPreview',
  component: MermaidPreviewStory,
} satisfies Meta<MermaidPreviewProps>

export default meta
type Story = StoryObj<typeof meta>

const id = 'storybook-mermaid-preview'
const source = 'graph LR\n  Draft --> Preview'

export const Diagram: Story = {
  name: 'the preview draws a Mermaid flow diagram from its source.',
  args: { id, source },
}

export const EditingDiagram: Story = {
  name: 'the preview keeps the Mermaid source visible above its diagram.',
  args: { id, source, showSource: true },
}

export const SyntaxError: Story = {
  name: 'the preview shows the source and parser error for an invalid diagram.',
  args: { id, source: 'graph LR\n  Draft -->', showSource: true },
}
