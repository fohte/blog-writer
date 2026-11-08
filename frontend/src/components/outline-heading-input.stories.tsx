import type { Meta, StoryObj } from '@storybook/react-vite'

import { OutlineHeadingInput } from '#components/outline-heading-input'

const meta = {
  component: OutlineHeadingInput,
  args: {
    editing: { focusKey: 0, onAction: () => {}, onBlur: () => {} },
  },
} satisfies Meta<typeof OutlineHeadingInput>

export default meta
type Story = StoryObj<typeof meta>

export const SelectedHeading: Story = {
  name: 'The selected heading can be typed over.',
  args: { text: 'Keep the server simple' },
}
