import type { Meta, StoryObj } from '@storybook/react-vite'

import { OutlineMemoDropGap } from '#components/outline-memo-drop-gap'

const meta = {
  component: OutlineMemoDropGap,
  args: {
    beforeFrom: 24,
    active: false,
    onDragChange: () => {},
    onInsertMemo: () => {},
  },
} satisfies Meta<typeof OutlineMemoDropGap>

export default meta
type Story = StoryObj<typeof meta>

export const ReadyForDrop: Story = {
  name: 'the outline leaves a gap where a memo can become a heading.',
}

export const ActiveDrop: Story = {
  name: 'the outline highlights a gap under the dragged memo.',
  args: { active: true },
}
