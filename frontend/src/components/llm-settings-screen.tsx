import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { useEffect, useState } from 'react'

import { LlmSettingsView } from '#components/llm-settings-view'
import type { components } from '#lib/api/schema.gen.d.ts'
import { loadLlmSettings, saveLlmSettings } from '#lib/llm-settings'

type LlmStatus = components['schemas']['LlmStatusResponse']

const isLlmStatus = (value: unknown): value is LlmStatus => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'locked' in value &&
    typeof value.locked === 'boolean' &&
    'provider' in value &&
    (value.provider === 'claude_code' ||
      value.provider === 'openai_compatible') &&
    'web_search' in value &&
    typeof value.web_search === 'boolean'
  ) {
    return true
  }

  return false
}

const parseLlmStatus = (value: unknown) =>
  isLlmStatus(value)
    ? okAsync(value)
    : errAsync(new Error('Invalid LLM settings response'))

type LlmSettingsScreenProps = {
  onBack: () => void
}

const fetchLlmStatus = () =>
  ResultAsync.fromPromise(
    fetch('/api/llm/status'),
    (cause) => new Error('Failed to load LLM settings', { cause }),
  ).andThen((response) => {
    if (!response.ok) {
      return errAsync(
        new Error(`Failed to load LLM settings: ${String(response.status)}`),
      )
    }

    return ResultAsync.fromPromise(
      response.json().then((value: unknown) => value),
      (cause) => new Error('Failed to read LLM settings response', { cause }),
    ).andThen(parseLlmStatus)
  })

export function LlmSettingsScreen({ onBack }: LlmSettingsScreenProps) {
  const [settings, setSettings] = useState(() =>
    loadLlmSettings(window.localStorage),
  )
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true

    void fetchLlmStatus().match(
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
    saveLlmSettings(window.localStorage, nextSettings)
    setSettings(nextSettings)
  }

  return (
    <LlmSettingsView
      error={error}
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
    />
  )
}
