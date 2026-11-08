import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  MarkdownTablePreview,
  type MarkdownTablePreviewProps,
} from '#components/markdown-table-preview'

const meta = {
  title: 'Editor/MarkdownTablePreview',
  component: MarkdownTablePreview,
} satisfies Meta<MarkdownTablePreviewProps>

export default meta
type Story = StoryObj<typeof meta>

export const AlignedTable: Story = {
  name: 'the preview aligns each column according to the GFM delimiter row.',
  args: {
    header: ['Feature', 'Offline', 'Status'],
    alignment: ['left', 'center', 'right'],
    rows: [
      ['Tables', 'Yes', 'Ready'],
      ['Diagrams', 'Yes', 'Loading'],
    ],
  },
}
