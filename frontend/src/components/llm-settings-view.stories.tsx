import type { Meta, StoryObj } from '@storybook/react-vite'

import { LlmSettingsView } from '#components/llm-settings-view'

const meta = {
  component: LlmSettingsView,
  args: {
    onBack: () => {},
    onRouteChange: () => {},
    onBridgeUrlChange: () => {},
    storageError: undefined,
  },
} satisfies Meta<typeof LlmSettingsView>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {
  name: 'the settings page is loading LLM availability',
  args: {
    settings: { route: 'server', bridgeUrl: '' },
    status: 'loading',
    locked: false,
  },
}

export const ServerRoute: Story = {
  name: 'the server route is selected by default',
  args: {
    settings: { route: 'server', bridgeUrl: '' },
    status: 'ready',
    locked: false,
  },
}

export const LocalRoute: Story = {
  name: 'the local route shows its bridge URL',
  args: {
    settings: { route: 'local', bridgeUrl: 'http://localhost:4141' },
    status: 'ready',
    locked: false,
  },
}

export const Locked: Story = {
  name: 'the server controls the LLM settings',
  args: {
    settings: { route: 'server', bridgeUrl: '' },
    status: 'ready',
    locked: true,
  },
}

export const LoadError: Story = {
  name: 'the LLM status request failed',
  args: {
    settings: { route: 'server', bridgeUrl: '' },
    status: 'error',
    locked: false,
    error: 'Unable to load LLM settings.',
  },
}

export const StorageUnavailable: Story = {
  name: 'the settings cannot be saved on this device',
  args: {
    settings: { route: 'local', bridgeUrl: 'http://localhost:4141' },
    status: 'ready',
    locked: false,
    storageError: 'save',
  },
}

export const StorageLoadUnavailable: Story = {
  name: 'the settings could not be loaded from this device',
  args: {
    settings: { route: 'server', bridgeUrl: '' },
    status: 'ready',
    locked: false,
    storageError: 'load',
  },
}

export const FileSyncConfigured: Story = {
  name: 'the settings page shows its synchronization folder',
  args: {
    fileSyncDirectory: '/workspace/articles',
    settings: { route: 'server', bridgeUrl: '' },
    status: 'ready',
    locked: false,
  },
}

export const FileSyncConfigurationError: Story = {
  name: 'the settings page shows a synchronization configuration error',
  args: {
    fileSyncConfigurationError: '同期設定を読み込めませんでした。',
    settings: { route: 'server', bridgeUrl: '' },
    status: 'ready',
    locked: false,
  },
}
