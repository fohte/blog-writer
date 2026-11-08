import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useRef } from 'react'

import {
  createMarkdownTablePreview,
  type MarkdownTablePreviewProps,
} from '#components/markdown-table-preview'

function MarkdownTablePreviewStory(props: MarkdownTablePreviewProps) {
  const container = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (container.current)
      container.current.replaceChildren(createMarkdownTablePreview(props))
  }, [props])

  return <div ref={container} />
}

const meta = {
  title: 'Editor/MarkdownTablePreview',
  component: MarkdownTablePreviewStory,
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
