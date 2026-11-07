import type { Meta, StoryObj } from '@storybook/react-vite'

import { SuggestionGeneratingBar } from '#components/suggestion-generating-bar'

const meta = {
  component: SuggestionGeneratingBar,
  args: { elapsedSeconds: 4, onCancel: () => {} },
} satisfies Meta<typeof SuggestionGeneratingBar>

export default meta
type Story = StoryObj<typeof meta>

export const Requested: Story = {
  name: 'a requested suggestion shows the request, the elapsed seconds and a cancel button',
  args: { label: '簡潔にする' },
}

export const Unlabeled: Story = {
  name: 'a suggestion without a request label shows only the elapsed seconds and a cancel button',
}
