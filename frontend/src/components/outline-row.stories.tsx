import type { Meta, StoryObj } from '@storybook/react-vite'

import { OutlineRow } from '#components/outline-row'

const heading = {
  level: 2,
  text: 'Keep the server simple',
  from: 0,
  to: 25,
  children: [],
}

const meta = {
  component: OutlineRow,
  args: {
    active: false,
    allHeadings: [{ heading, depth: 0 }],
    bodyLength: 26,
    depth: 0,
    dropTarget: undefined,
    heading,
    memoCount: 0,
    moveConflictCount: 0,
    onMemoDropTargetChange: () => {},
    onMove: () => {},
    onSelect: () => {},
    openMenu: false,
  },
} satisfies Meta<typeof OutlineRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'A heading row shows its level and text.',
}

export const Editing: Story = {
  name: 'A heading row selected from the keyboard shows an input.',
  args: {
    editing: { focusKey: 0, onAction: () => {}, onBlur: () => {} },
  },
}
