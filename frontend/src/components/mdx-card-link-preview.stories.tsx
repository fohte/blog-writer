import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useRef } from 'react'

import {
  createMdxCardLinkPreview,
  type MdxCardLinkPreviewProps,
} from '#components/mdx-card-link-preview'

function CardLinkStory(props: MdxCardLinkPreviewProps) {
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    element.replaceChildren(createMdxCardLinkPreview(props))
    return () => {
      element.replaceChildren()
    }
  }, [props])

  return <div ref={host} />
}

const meta = {
  title: 'Editor/MdxCardLinkPreview',
  render: (props: MdxCardLinkPreviewProps) => <CardLinkStory {...props} />,
} satisfies Meta<MdxCardLinkPreviewProps>

export default meta
type Story = StoryObj<typeof meta>

export const WithMetadata: Story = {
  name: 'the card shows its title, domain, description, and image.',
  args: {
    href: 'https://docs.example.test/guide',
    ogp: {
      available: true,
      description: 'A short guide to a useful topic.',
      final_url: 'https://docs.example.test/guide',
      image:
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="100"%3E%3Crect width="160" height="100" fill="%23dbeafe"/%3E%3C/svg%3E',
      title: 'A useful guide',
    },
  },
}

export const WithoutMetadata: Story = {
  name: 'the card falls back to its URL and domain when metadata is unavailable.',
  args: { href: 'https://docs.example.test/unknown' },
}
