import type { Meta, StoryObj } from '@storybook/react-vite'

import { OutlineKeyHints } from '#components/outline-key-hints'

const meta = {
  component: OutlineKeyHints,
} satisfies Meta<typeof OutlineKeyHints>

export default meta
type Story = StoryObj<typeof meta>

export const AllKeys: Story = {
  name: 'The outline lists every key that edits headings.',
}
