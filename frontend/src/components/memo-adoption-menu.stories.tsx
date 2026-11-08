import type { Meta, StoryObj } from '@storybook/react-vite'

import { MemoAdoptionMenu } from '#components/memo-adoption-menu'

const memo = {
  id: 'memo-a',
  text: '記事の導入を簡潔にする',
  order: 0,
  state: { kind: 'unorganized' as const },
}

const headings = [
  {
    level: 1,
    text: 'Overview',
    from: 0,
    to: 11,
    children: [{ level: 2, text: 'Goals', from: 13, to: 21, children: [] }],
  },
  { level: 1, text: 'Details', from: 23, to: 33, children: [] },
]

const meta = {
  component: MemoAdoptionMenu,
  args: {
    memo,
    headings,
    cursorOffset: 13,
    open: true,
    canMoveUp: false,
    canMoveDown: true,
    onOpenChange: () => {},
    onAdoptToHeading: () => {},
    onInsertAsHeading: () => {},
    onMove: () => {},
    onDismiss: () => {},
    onRestore: () => {},
  },
} satisfies Meta<typeof MemoAdoptionMenu>

export default meta
type Story = StoryObj<typeof meta>

export const ExistingAndNewTargets: Story = {
  name: 'the menu offers a heading one level below the cursor heading and lists existing headings.',
}

export const FilteredHeadings: Story = {
  name: 'the filter narrows the existing headings to those that match.',
  args: { defaultHeadingQuery: 'go' },
}

export const NoMatchingHeadings: Story = {
  name: 'the filter says so when no existing heading matches.',
  args: { defaultHeadingQuery: 'missing' },
}

export const DeepestHeading: Story = {
  name: 'under a level six heading, level six is the only choice.',
  args: {
    cursorOffset: 0,
    headings: [{ level: 6, text: 'Deepest', from: 0, to: 14, children: [] }],
  },
}

export const Closed: Story = {
  name: 'the memo shows a button for choosing its adoption target.',
  args: { open: false },
}

export const NoHeadings: Story = {
  name: 'the menu can add a memo as the first heading.',
  args: { headings: [] },
}

export const Sheet: Story = {
  name: 'on a phone, the adoption targets open in a bottom sheet with touch-sized rows.',
  args: { presentation: 'sheet' },
}

export const AdoptedMemo: Story = {
  name: 'the menu for an adopted memo can also return it to unorganized.',
  args: {
    canMoveUp: true,
    memo: {
      ...memo,
      state: {
        kind: 'adopted',
        heading: { level: 2, text: 'Goals', from: 13, to: 21, children: [] },
      },
    },
  },
}
