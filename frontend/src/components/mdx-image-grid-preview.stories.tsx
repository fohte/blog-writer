import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useRef } from 'react'

import { createMarkdownImagePreview } from '#components/markdown-image-preview'
import { createMdxImageGridPreview } from '#components/mdx-image-grid-preview'

type StoryArgs = { imageCount: number }

const imageSource =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="240" height="160"%3E%3Crect width="240" height="160" fill="%23dbeafe"/%3E%3C/svg%3E'

function ImageGridStory({ imageCount }: StoryArgs) {
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    element.replaceChildren(
      createMdxImageGridPreview({
        images: Array.from({ length: imageCount }, (_, index) => {
          const alt = `Image ${String(index + 1)}`
          const source = `![${alt}](${imageSource})`
          return createMarkdownImagePreview({
            alt,
            source,
            src: imageSource,
          })
        }),
      }),
    )
    return () => {
      element.replaceChildren()
    }
  }, [imageCount])

  return <div ref={host} />
}

const meta = {
  title: 'Editor/MdxImageGridPreview',
  render: (props: StoryArgs) => <ImageGridStory {...props} />,
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const TwoImages: Story = {
  name: 'two images share a row at wider viewport widths.',
  args: { imageCount: 2 },
}
