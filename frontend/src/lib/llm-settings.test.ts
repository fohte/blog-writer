import { describe, expect, it } from 'vitest'

import { loadLlmSettings, saveLlmSettings } from '#lib/llm-settings'

const createStorage = () => {
  const values = new Map<string, string>()

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('LLM settings storage', () => {
  it('defaults to the server and restores the selected route and bridge URL', () => {
    const storage = createStorage()
    const defaults = loadLlmSettings(storage)
    saveLlmSettings(storage, {
      route: 'local',
      bridgeUrl: 'http://localhost:4141',
    })

    const readSettings = () => [defaults, loadLlmSettings(storage)]

    expect(readSettings()).toEqual([
      { route: 'server', bridgeUrl: '' },
      { route: 'local', bridgeUrl: 'http://localhost:4141' },
    ])
  })
})
