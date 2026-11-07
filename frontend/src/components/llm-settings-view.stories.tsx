import type { Meta, StoryObj } from '@storybook/react-vite'

import { LlmSettingsView } from '#components/llm-settings-view'

const localSettings = {
  route: 'local',
  bridgeUrl: 'http://127.0.0.1:4312',
} as const

const meta = {
  component: LlmSettingsView,
  args: {
    settings: { route: 'server', bridgeUrl: '' },
    status: 'ready',
    locked: false,
    unsaved: false,
    bridgeUnreachable: false,
    storageError: undefined,
    onBack: () => {},
    onRouteChange: () => {},
    onBridgeUrlChange: () => {},
    onSave: () => {},
  },
} satisfies Meta<typeof LlmSettingsView>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {
  name: 'the settings page is loading LLM availability',
  args: { status: 'loading' },
}

export const ServerRoute: Story = {
  name: 'the saved server route leaves nothing to save',
}

export const LocalRoute: Story = {
  name: 'the local route shows its bridge URL',
  args: { settings: localSettings },
}

export const UnsavedChanges: Story = {
  name: 'an edited route waits for the save button',
  args: { settings: localSettings, unsaved: true },
}

export const BridgeUnreachable: Story = {
  name: 'the saved bridge URL cannot be reached',
  args: { settings: localSettings, bridgeUnreachable: true },
}

export const Locked: Story = {
  name: 'the server controls the LLM settings',
  args: { locked: true },
}

export const LoadError: Story = {
  name: 'the LLM status request failed',
  args: { status: 'error' },
}

export const StorageUnavailable: Story = {
  name: 'the settings cannot be saved on this device',
  args: { settings: localSettings, unsaved: true, storageError: 'save' },
}

export const StorageLoadUnavailable: Story = {
  name: 'the settings could not be loaded from this device',
  args: { storageError: 'load' },
}

export const FileSyncConfigured: Story = {
  name: 'the settings page shows its synchronization folder',
  args: { fileSyncDirectory: '/workspace/articles' },
}

export const FileSyncConfigurationError: Story = {
  name: 'the settings page shows a synchronization configuration error',
  args: { fileSyncConfigurationError: '同期設定を読み込めませんでした。' },
}
