import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse } from 'msw'

import { App } from '#App'

const meta = {
  component: App,
} satisfies Meta<typeof App>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'the page shows the empty article list',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/file-sync/configuration', () =>
          HttpResponse.json({ enabled: false, directory: null }),
        ),
      ],
    },
  },
}
