import { useEffect, useState } from 'react'

import { LlmSettingsView } from '#components/llm-settings-view'
import {
  defaultLlmSettings,
  loadLlmSettings,
  saveLlmSettings,
} from '#lib/llm-settings'
import { fetchLlmStatus } from '#lib/llm-status'

type LlmSettingsScreenProps = {
  onBack: () => void
  fileSyncDirectory?: string | undefined
  fileSyncConfigurationError?: string | undefined
}

export function LlmSettingsScreen({
  onBack,
  fileSyncDirectory,
  fileSyncConfigurationError,
}: LlmSettingsScreenProps) {
  const [initialSettings] = useState(() =>
    loadLlmSettings(() => window.localStorage),
  )
  const [settings, setSettings] = useState(() =>
    initialSettings.match(
      (savedSettings) => savedSettings,
      () => defaultLlmSettings,
    ),
  )
  const [storageError, setStorageError] = useState<'load' | 'save' | undefined>(
    () => (initialSettings.isErr() ? 'load' : undefined),
  )
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true

    void fetchLlmStatus(fetch).match(
      (response) => {
        if (!active) return
        setLocked(response.locked)
        setStatus('ready')
      },
      (loadError) => {
        if (!active) return
        setError(loadError.message)
        setStatus('error')
      },
    )

    return () => {
      active = false
    }
  }, [])

  const updateSettings = (nextSettings: typeof settings) => {
    saveLlmSettings(() => window.localStorage, nextSettings).match(
      () => {
        setStorageError(undefined)
      },
      () => {
        setStorageError('save')
      },
    )
    setSettings(nextSettings)
  }

  return (
    <LlmSettingsView
      error={error}
      fileSyncDirectory={fileSyncDirectory}
      fileSyncConfigurationError={fileSyncConfigurationError}
      locked={locked}
      onBack={onBack}
      onBridgeUrlChange={(bridgeUrl) => {
        updateSettings({ ...settings, bridgeUrl })
      }}
      onRouteChange={(route) => {
        updateSettings({ ...settings, route })
      }}
      settings={settings}
      status={status}
      storageError={storageError}
    />
  )
}
