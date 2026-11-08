import type { Meta, StoryObj } from '@storybook/react-vite'

import { OutlineModeIntro } from '#components/outline-mode-intro'

const meta = {
  component: OutlineModeIntro,
  args: { title: 'A useful article' },
} satisfies Meta<typeof OutlineModeIntro>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Outline mode names the article and says that only headings are shown.',
}
