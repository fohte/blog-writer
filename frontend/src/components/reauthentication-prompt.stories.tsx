import type { Meta, StoryObj } from '@storybook/react-vite'

import { ReauthenticationPrompt } from '#components/reauthentication-prompt'

const meta = {
  component: ReauthenticationPrompt,
} satisfies Meta<typeof ReauthenticationPrompt>

export default meta
type Story = StoryObj<typeof meta>

export const AccessSessionExpired: Story = {
  name: 'the prompt asks the writer to log in again while edits stay on this device.',
  args: { onLoginAgain: () => undefined },
}
