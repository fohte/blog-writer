import type { Meta, StoryObj } from '@storybook/react-vite'

import { ReauthenticationPrompt } from '#components/reauthentication-prompt'

const meta = {
  component: ReauthenticationPrompt,
} satisfies Meta<typeof ReauthenticationPrompt>

export default meta
type Story = StoryObj<typeof meta>

export const AccessSessionExpired: Story = {
  name: 'Cloudflare Access asks the reader to sign in again.',
  args: { onLoginAgain: () => undefined },
}
