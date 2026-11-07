import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'

import { LlmSettingsView } from '#components/llm-settings-view'
import {
  defaultLlmSettings,
  type LlmSettings,
  loadLlmSettings,
  saveLlmSettings,
} from '#lib/llm-settings'
import { fetchLlmStatus } from '#lib/llm-status'

type LlmSettingsScreenProps = {
  onBack: () => void
  fileSyncDirectory?: string | undefined
  fileSyncConfigurationError?: string | undefined
}

// The unreachable URL is stored instead of a flag so a late response for an
// older URL cannot mark the URL being edited.
const checkBridge = (
  target: LlmSettings,
  setUnreachableBridgeUrl: Dispatch<SetStateAction<string | undefined>>,
) => {
  if (target.route !== 'local' || target.bridgeUrl.trim().length === 0) return

  void fetchLlmStatus(fetch, target.bridgeUrl).match(
    () => {
      setUnreachableBridgeUrl((current) =>
        current === target.bridgeUrl ? undefined : current,
      )
    },
    () => {
      setUnreachableBridgeUrl(target.bridgeUrl)
    },
  )
}

export function LlmSettingsScreen({
  onBack,
  fileSyncDirectory,
  fileSyncConfigurationError,
}: LlmSettingsScreenProps) {
  const [initialSettings] = useState(() =>
    loadLlmSettings(() => window.localStorage).match(
      (settings) => ({ settings, loadFailed: false }),
      () => ({ settings: defaultLlmSettings, loadFailed: true }),
    ),
  )
  const [savedSettings, setSavedSettings] = useState(initialSettings.settings)
  const [settings, setSettings] = useState(initialSettings.settings)
  const [storageError, setStorageError] = useState<'load' | 'save' | undefined>(
    initialSettings.loadFailed ? 'load' : undefined,
  )
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [locked, setLocked] = useState(false)
  const [unreachableBridgeUrl, setUnreachableBridgeUrl] = useState<string>()

  useEffect(() => {
    let active = true

    void fetchLlmStatus(fetch).match(
      (response) => {
        if (!active) return
        setLocked(response.locked)
        setStatus('ready')
        if (!response.locked)
          checkBridge(initialSettings.settings, setUnreachableBridgeUrl)
      },
      () => {
        if (active) setStatus('error')
      },
    )

    return () => {
      active = false
    }
  }, [initialSettings])

  return (
    <LlmSettingsView
      bridgeUnreachable={
        settings.route === 'local' &&
        settings.bridgeUrl === unreachableBridgeUrl
      }
      fileSyncDirectory={fileSyncDirectory}
      fileSyncConfigurationError={fileSyncConfigurationError}
      locked={locked}
      onBack={onBack}
      onBridgeUrlChange={(bridgeUrl) => {
        setSettings({ ...settings, bridgeUrl })
      }}
      onRouteChange={(route) => {
        setSettings({ ...settings, route })
      }}
      onSave={() => {
        saveLlmSettings(() => window.localStorage, settings).match(
          () => {
            setStorageError(undefined)
            setSavedSettings(settings)
            checkBridge(settings, setUnreachableBridgeUrl)
          },
          () => {
            setStorageError('save')
          },
        )
      }}
      settings={settings}
      status={status}
      storageError={storageError}
      unsaved={
        settings.route !== savedSettings.route ||
        settings.bridgeUrl !== savedSettings.bridgeUrl
      }
    />
  )
}
