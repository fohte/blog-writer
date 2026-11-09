import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useRef } from 'react'

import {
  createMermaidPreviewElement,
  type MermaidPreviewProps,
} from '#components/mermaid-preview'

function DOMPreview<Props>({
  createElement,
  props,
}: {
  createElement: (props: Props) => HTMLElement
  props: Props
}) {
  const container = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    element.replaceChildren(createElement(props))
    return () => {
      element.replaceChildren()
    }
  }, [createElement, props])

  return <div ref={container} />
}

const meta = {
  title: 'Editor/MermaidPreview',
  render: (props: MermaidPreviewProps) => (
    <DOMPreview createElement={createMermaidPreviewElement} props={props} />
  ),
} satisfies Meta<MermaidPreviewProps>

export default meta
type Story = StoryObj<typeof meta>

const id = 'storybook-mermaid-preview'
const source = 'graph LR\n  Draft --> Preview'
const sequenceSource = [
  'sequenceDiagram',
  '  Client->>Server: Submit article',
  '  Server-->>Client: Save confirmation',
].join('\n')

export const Diagram: Story = {
  name: 'the preview draws a Mermaid flow diagram from its source.',
  args: { id, source },
}

export const EditingDiagram: Story = {
  name: 'the preview keeps the Mermaid source visible above its diagram.',
  args: { id, source, showSource: true },
}

export const SequenceDiagram: Story = {
  name: 'the preview draws readable labels and arrows in a sequence diagram.',
  args: { id: 'storybook-mermaid-sequence-preview', source: sequenceSource },
}

export const SyntaxError: Story = {
  name: 'the preview shows the source and parser error for an invalid diagram.',
  args: { id, source: 'graph LR\n  Draft -->', showSource: true },
}
