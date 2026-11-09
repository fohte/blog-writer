import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useRef } from 'react'

import {
  createMdxSpeakerDeckPreview,
  type MdxSpeakerDeckPreviewProps,
} from '#components/mdx-speaker-deck-preview'

function SpeakerDeckStory(props: MdxSpeakerDeckPreviewProps) {
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    element.replaceChildren(createMdxSpeakerDeckPreview(props))
    return () => {
      element.replaceChildren()
    }
  }, [props])

  return <div ref={host} />
}

const meta = {
  title: 'Editor/MdxSpeakerDeckPreview',
  render: (props: MdxSpeakerDeckPreviewProps) => (
    <SpeakerDeckStory {...props} />
  ),
} satisfies Meta<MdxSpeakerDeckPreviewProps>

export default meta
type Story = StoryObj<typeof meta>

export const Player: Story = {
  name: 'the player keeps a stable 16:9 frame for visual checks.',
  args: { id: 'fixture123', staticFrame: true },
}
