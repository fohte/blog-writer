import type { Meta, StoryObj } from '@storybook/react-vite'

import { HeadingResearchAccessory } from '#components/heading-research-accessory'

const meta = {
  component: HeadingResearchAccessory,
  args: {
    onResearch: () => {},
  },
} satisfies Meta<typeof HeadingResearchAccessory>

export default meta
type Story = StoryObj<typeof meta>

export const NoHeading: Story = {
  name: '見出しが選ばれていない',
}

export const SelectedHeading: Story = {
  name: '問いが未入力なら見出しを使う',
  args: {
    heading: {
      level: 2,
      text: '地域別の利用状況',
      from: 0,
      to: 12,
      children: [],
    },
  },
}
