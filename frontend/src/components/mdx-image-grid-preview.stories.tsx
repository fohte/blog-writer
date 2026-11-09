import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useRef } from 'react'

import { createMdxImageGridPreview } from '#components/mdx-image-grid-preview'

type StoryArgs = { captions: string[] }

function createStoryImage(caption: string): HTMLElement {
  const figure = document.createElement('figure')
  figure.className = 'mt-4'
  const image = document.createElement('img')
  image.className = 'max-h-64 w-full rounded-md object-contain'
  image.alt = caption
  image.src =
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="240" height="160"%3E%3Crect width="240" height="160" fill="%23dbeafe"/%3E%3C/svg%3E'
  figure.append(image)
  const label = document.createElement('figcaption')
  label.className = 'mt-2 text-center text-sm text-muted-foreground'
  label.textContent = caption
  figure.append(label)
  return figure
}

function ImageGridStory({ captions }: StoryArgs) {
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    element.replaceChildren(
      createMdxImageGridPreview({
        images: captions.map(createStoryImage),
      }),
    )
    return () => {
      element.replaceChildren()
    }
  }, [captions])

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
  args: { captions: ['First image', 'Second image'] },
}
