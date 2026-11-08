import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse } from 'msw'

import {
  createMarkdownImagePreview,
  type MarkdownImagePreviewProps,
} from '#components/markdown-image-preview'
import { DOMPreview } from '#stories/dom-preview'

const meta = {
  title: 'Editor/MarkdownImagePreview',
  render: (props: MarkdownImagePreviewProps) => (
    <DOMPreview createElement={createMarkdownImagePreview} props={props} />
  ),
} satisfies Meta<MarkdownImagePreviewProps>

export default meta
type Story = StoryObj<typeof meta>

const imageUrl = 'https://assets.example.test/images/landscape.svg?w=320&h=180'
const source = `![A landscape](${imageUrl})`
const imageSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#dbeafe"/></svg>'

export const Image: Story = {
  name: 'the preview draws an image using its width and height query parameters.',
  args: {
    alt: 'A landscape',
    source,
    src: imageUrl,
  },
  parameters: {
    msw: [
      http.get('https://assets.example.test/images/landscape.svg', () =>
        HttpResponse.text(imageSvg, {
          headers: { 'Content-Type': 'image/svg+xml' },
        }),
      ),
    ],
  },
}

export const LoadFailure: Story = {
  name: 'the preview shows the original Markdown when an image URL with dimensions fails to load.',
  args: {
    alt: '',
    source: '![](https://assets.example.test/images/missing.webp?w=640&h=360)',
    src: 'https://assets.example.test/images/missing.webp?w=640&h=360',
    failed: true,
  },
}
