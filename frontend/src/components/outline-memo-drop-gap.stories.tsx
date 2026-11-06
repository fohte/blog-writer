import type { Meta, StoryObj } from '@storybook/react-vite'

import { OutlineMemoDropGap } from '#components/outline-memo-drop-gap'

const meta = {
  component: OutlineMemoDropGap,
  args: {
    beforeFrom: 24,
    bodyLength: 80,
    active: false,
    onDragChange: () => {},
    onInsertMemo: () => {},
    onMove: () => {},
  },
} satisfies Meta<typeof OutlineMemoDropGap>

export default meta
type Story = StoryObj<typeof meta>

export const ReadyForDrop: Story = {
  name: 'the outline leaves a gap for dropped content.',
}

export const ActiveDrop: Story = {
  name: 'the outline highlights a drop gap.',
  args: { active: true },
}
