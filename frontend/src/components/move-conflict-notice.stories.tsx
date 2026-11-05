import type { Meta, StoryObj } from '@storybook/react-vite'

import { MoveConflictNotice } from '#components/move-conflict-notice'

const meta = {
  component: MoveConflictNotice,
} satisfies Meta<typeof MoveConflictNotice>

export default meta
type Story = StoryObj<typeof meta>

export const StrayText: Story = {
  name: 'A concurrent sentence can move with its section or stay here.',
  args: { text: 'A sentence written while the section was offline.' },
}

export const ChangedBeforeSelection: Story = {
  name: 'The text changes before its selection can be applied.',
  args: {
    status:
      'This text changed before the choice could be applied. Review the updated text.',
    text: 'A sentence written while the section was offline.',
  },
}
