import type { Meta, StoryObj } from '@storybook/react-vite'

import { ArticleRowMenu } from '#components/article-row-menu'

const meta = {
  component: ArticleRowMenu,
  args: {
    onDuplicate: () => {},
    onTrash: () => {},
  },
} satisfies Meta<typeof ArticleRowMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {
  name: 'the row shows only a button that opens its actions.',
}

export const Open: Story = {
  name: 'the open menu offers duplicating and trashing and says how long the trash keeps an article.',
  args: { defaultOpen: true },
}
