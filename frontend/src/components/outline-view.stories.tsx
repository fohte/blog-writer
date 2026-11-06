import type { Meta, StoryObj } from '@storybook/react-vite'

import { OutlineView } from '#components/outline-view'

const headings = [
  {
    level: 1,
    text: 'Overview',
    from: 0,
    to: 11,
    children: [
      { level: 2, text: 'Goals', from: 13, to: 21, children: [] },
      { level: 2, text: 'Approach', from: 23, to: 34, children: [] },
    ],
  },
  { level: 1, text: 'Details', from: 36, to: 47, children: [] },
]

const meta = {
  title: 'Editor/OutlineView',
  component: OutlineView,
  args: {
    headings,
    bodyLength: 48,
    onSelect: () => {},
    onMove: () => {},
  },
} satisfies Meta<typeof OutlineView>

export default meta
type Story = StoryObj<typeof meta>

export const NestedHeadings: Story = {
  name: 'the outline shows nested headings.',
  args: {},
}

export const SelectedHeading: Story = {
  name: 'the outline marks the heading selected in the editor.',
  args: { activeFrom: 13 },
}

export const OpenMoveMenu: Story = {
  name: 'the outline shows the available moves for a heading.',
  args: { openMenuFrom: 13 },
}

export const ChildDropTarget: Story = {
  name: 'the outline shows where a heading will become a child.',
  args: { dropTarget: { kind: 'move', from: 13, placement: 'child' } },
}

export const BeforeDropTarget: Story = {
  name: 'the outline shows where a heading will move before another heading.',
  args: { dropTarget: { kind: 'move', from: 13, placement: 'before' } },
}

export const AfterDropTarget: Story = {
  name: 'the outline shows where a heading will move after another heading.',
  args: { dropTarget: { kind: 'move', from: 13, placement: 'after' } },
}

export const MemoHeadingDropTarget: Story = {
  name: 'the outline highlights a heading that will adopt a memo.',
  args: { dropTarget: { kind: 'memo-heading', from: 13 } },
}

export const MemoGapDropTarget: Story = {
  name: 'the outline highlights where a memo will become a new heading.',
  args: { dropTarget: { kind: 'memo-gap', beforeFrom: 23 } },
}

export const EmptyOutline: Story = {
  name: 'the outline explains that the article has no headings yet.',
  args: { headings: [] },
}

export const MoveError: Story = {
  name: 'the outline explains why a move could not be completed.',
  args: { error: 'この位置には移動できません。' },
}
