import type { Meta, StoryObj } from '@storybook/react-vite'

import { OutlineRowBadges } from '#components/outline-row-badges'

const meta = {
  component: OutlineRowBadges,
} satisfies Meta<typeof OutlineRowBadges>

export default meta
type Story = StoryObj<typeof meta>

export const MemosOnly: Story = {
  name: 'A heading with adopted memos shows only the memo count.',
  args: { memoCount: 2, moveConflictCount: 0 },
}

export const MoveConflictsOnly: Story = {
  name: 'A heading with leftover text shows only the conflict count.',
  args: { memoCount: 0, moveConflictCount: 1 },
}

export const MemosAndMoveConflicts: Story = {
  name: 'A heading with memos and leftover text shows both counts.',
  args: { memoCount: 2, moveConflictCount: 1 },
}
