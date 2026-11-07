import type { Meta, StoryObj } from '@storybook/react-vite'

import { HeadingResearchOutlineView } from '#components/heading-research-outline-view'
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
  title: 'Editor/HeadingResearchOutlineView',
  component: HeadingResearchOutlineView,
  args: {
    heading: headings[0]?.children[0],
    busy: false,
    onResearch: () => {},
    children: (
      <OutlineView
        activeFrom={13}
        bodyLength={48}
        headings={headings}
        onMove={() => {}}
        onSelect={() => {}}
      />
    ),
  },
} satisfies Meta<typeof HeadingResearchOutlineView>

export default meta
type Story = StoryObj<typeof meta>

export const SelectedHeading: Story = {
  name: 'the selected heading and its outline remain visible.',
}
