import type { Meta, StoryObj } from '@storybook/react-vite'

import { BodyRequestView } from '#components/body-request-view'

const meta = {
  component: BodyRequestView,
  args: {
    anchor: null,
    open: true,
    touchDevice: false,
    phase: 'input',
    instruction: '',
    onOpenChange: () => {},
    onInstructionChange: () => {},
    onSubmit: () => {},
  },
} satisfies Meta<typeof BodyRequestView>

export default meta
type Story = StoryObj<typeof meta>

export const ReadyToRequest: Story = {
  name: 'the writer can enter a request for the selected text',
  args: { instruction: 'この段落を短くしてください' },
}

export const TouchRequest: Story = {
  name: 'a touch device shows a request button',
  args: { touchDevice: true },
}

export const Failed: Story = {
  name: 'a failed request shows an error',
  args: {
    phase: 'error',
    instruction: 'この段落を短くしてください',
    error: '提案を作成できませんでした。',
  },
}
