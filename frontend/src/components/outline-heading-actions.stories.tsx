import type { Meta, StoryObj } from '@storybook/react-vite'

import { OutlineHeadingActions } from '#components/outline-heading-actions'

const noop = () => {}

const meta = {
  component: OutlineHeadingActions,
  args: { onUndo: noop },
} satisfies Meta<typeof OutlineHeadingActions>

export default meta

type Story = StoryObj<typeof meta>

export const AllActions: Story = {
  name: 'every action is available for a heading in the middle of the outline',
  args: {
    onDelete: noop,
    onIndent: noop,
    onMoveDown: noop,
    onMoveUp: noop,
    onOutdent: noop,
  },
}

export const NoSelection: Story = {
  name: 'only undo is available when no heading is selected',
}
