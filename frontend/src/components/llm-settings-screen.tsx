import { type RefObject, useEffect, useRef, useState } from 'react'

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

const checkBridge = (
  target: LlmSettings,
  latestProbe: RefObject<number>,
  setUnreachableBridgeUrl: (url: string | undefined) => void,
) => {
  if (target.route !== 'local' || target.bridgeUrl.trim().length === 0) return

  // A slow response from an earlier probe must not override a newer one.
  latestProbe.current += 1
  const probe = latestProbe.current
  void fetchLlmStatus(fetch, target.bridgeUrl).match(
    () => {
      if (probe === latestProbe.current) setUnreachableBridgeUrl(undefined)
    },
    () => {
      if (probe === latestProbe.current)
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
  // Stored as the URL so the error hides while another URL is being edited.
  const [unreachableBridgeUrl, setUnreachableBridgeUrl] = useState<string>()
  const latestBridgeProbe = useRef(0)

  useEffect(() => {
    let active = true

    void fetchLlmStatus(fetch).match(
      (response) => {
        if (!active) return
        setLocked(response.locked)
        setStatus('ready')
        if (!response.locked)
          checkBridge(
            initialSettings.settings,
            latestBridgeProbe,
            setUnreachableBridgeUrl,
          )
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
            checkBridge(settings, latestBridgeProbe, setUnreachableBridgeUrl)
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
