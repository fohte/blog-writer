import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  MermaidPreview,
  type MermaidPreviewProps,
} from '#components/mermaid-preview'

const meta = {
  title: 'Editor/MermaidPreview',
  component: MermaidPreview,
} satisfies Meta<MermaidPreviewProps>

export default meta
type Story = StoryObj<typeof meta>

const source = 'graph LR\n  Draft --> Preview'

export const Diagram: Story = {
  name: 'the editor draws a Mermaid flow diagram from the source.',
  args: { source },
}

export const EditingDiagram: Story = {
  name: 'the editor keeps the Mermaid source visible above its preview.',
  args: { source, showSource: true },
}

export const SyntaxError: Story = {
  name: 'the editor shows the source and parser error for an invalid diagram.',
  args: { source: 'graph LR\n  Draft -->', showSource: true },
}
