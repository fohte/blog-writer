import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  createMermaidPreviewElement,
  type MermaidPreviewProps,
} from '#components/mermaid-preview'
import { DOMPreview } from '#stories/dom-preview'

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
