import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  MarkdownImagePreview,
  type MarkdownImagePreviewProps,
} from '#components/markdown-image-preview'

const meta = {
  title: 'Editor/MarkdownImagePreview',
  component: MarkdownImagePreview,
} satisfies Meta<MarkdownImagePreviewProps>

export default meta
type Story = StoryObj<typeof meta>

const imageUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='%23dbeafe'/%3E%3C/svg%3E"
const source = `![](${imageUrl})`

export const Image: Story = {
  name: 'the preview preserves the image source URL and query string.',
  args: {
    alt: 'A landscape',
    source,
    src: imageUrl,
  },
}

export const LoadFailure: Story = {
  name: 'the preview shows the original Markdown when the image fails to load.',
  args: {
    alt: '',
    source,
    src: 'https://assets.example.test/images/missing.webp?w=640&h=360',
    failed: true,
  },
}
