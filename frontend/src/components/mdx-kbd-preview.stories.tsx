import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useRef } from 'react'

import {
  createMdxKbdPreview,
  type MdxKbdPreviewProps,
} from '#components/mdx-kbd-preview'

function KbdStory(props: MdxKbdPreviewProps) {
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    element.replaceChildren(createMdxKbdPreview(props))
    return () => {
      element.replaceChildren()
    }
  }, [props])

  return <div ref={host} />
}

const meta = {
  title: 'Editor/MdxKbdPreview',
  render: (props: MdxKbdPreviewProps) => <KbdStory {...props} />,
} satisfies Meta<MdxKbdPreviewProps>

export default meta
type Story = StoryObj<typeof meta>

export const Key: Story = {
  name: 'a key label appears inside a keyboard key.',
  args: { value: 'Cmd' },
}
