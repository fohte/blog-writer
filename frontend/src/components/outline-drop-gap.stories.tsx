import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'

import { OutlineDropGap } from '#components/outline-drop-gap'

function renderOutlineGap(args: ComponentProps<typeof OutlineDropGap>) {
  return (
    <div aria-label="Article outline" className="flex w-80 flex-col gap-2 p-4">
      <div className="rounded border p-2 text-sm">Introduction</div>
      <OutlineDropGap {...args} />
      <div className="rounded border p-2 text-sm">Next steps</div>
    </div>
  )
}

const meta = {
  component: OutlineDropGap,
  render: renderOutlineGap,
  args: {
    beforeFrom: 24,
    bodyLength: 80,
    active: false,
    onDragChange: () => {},
    onInsertMemo: () => {},
    onMove: () => {},
  },
} satisfies Meta<typeof OutlineDropGap>

export default meta
type Story = StoryObj<typeof meta>

export const ReadyForDrop: Story = {
  name: 'the outline leaves a gap for dropped content.',
}

export const ActiveDrop: Story = {
  name: 'the outline highlights a drop gap.',
  args: { active: true },
}
