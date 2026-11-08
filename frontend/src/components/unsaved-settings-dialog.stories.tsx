import type { Meta, StoryObj } from '@storybook/react-vite'

import { UnsavedSettingsDialog } from '#components/unsaved-settings-dialog'

const meta = {
  component: UnsavedSettingsDialog,
  args: {
    open: true,
    onStay: () => {},
    onLeave: () => {},
  },
} satisfies Meta<typeof UnsavedSettingsDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  name: 'the dialog asks whether to leave the settings without saving the changes.',
}
