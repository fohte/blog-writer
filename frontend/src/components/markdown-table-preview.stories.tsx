import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useRef } from 'react'

import {
  createMarkdownTablePreview,
  type MarkdownTablePreviewProps,
} from '#components/markdown-table-preview'

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
  title: 'Editor/MarkdownTablePreview',
  render: (props: MarkdownTablePreviewProps) => (
    <DOMPreview createElement={createMarkdownTablePreview} props={props} />
  ),
} satisfies Meta<MarkdownTablePreviewProps>

export default meta
type Story = StoryObj<typeof meta>

export const AlignedTable: Story = {
  name: 'the preview formats inline Markdown and aligns columns from the GFM delimiter row.',
  args: {
    header: ['Feature', 'Guide', 'Example'],
    alignment: ['left', 'center', 'right'],
    rows: [
      [
        '**Tables**',
        '[dimensions](https://assets.example.test/guide?w=320&h=180)',
        '`Ready`',
      ],
      [
        '*Diagrams*',
        '[offline guide](https://assets.example.test/offline)',
        '~~Draft~~',
      ],
    ],
  },
}

export const UnsupportedLinkScheme: Story = {
  name: 'the preview leaves an unsupported link scheme as Markdown text.',
  args: {
    header: ['Link'],
    alignment: [null],
    rows: [['[blocked](javascript:0)']],
  },
}
