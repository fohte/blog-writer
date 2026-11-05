import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LlmSettingsScreen } from '#components/llm-settings-screen'

let host: HTMLDivElement | undefined
let root: Root | undefined
let localStorageDescriptor: PropertyDescriptor | undefined

const setLocalStorage = (storage: Pick<Storage, 'getItem' | 'setItem'>) => {
  localStorageDescriptor = Object.getOwnPropertyDescriptor(
    window,
    'localStorage',
  )
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  })
}

const mountSettingsScreen = async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  act(() => {
    root?.render(<LlmSettingsScreen onBack={() => {}} />)
  })

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = undefined
  host?.remove()
  host = undefined

  if (localStorageDescriptor) {
    Object.defineProperty(window, 'localStorage', localStorageDescriptor)
    localStorageDescriptor = undefined
  }

  vi.unstubAllGlobals()
})

describe('LlmSettingsScreen storage errors', () => {
  it('shows a load error when local settings cannot be read', async () => {
    setLocalStorage({
      getItem: () => {
        throw new Error('storage unavailable')
      },
      setItem: () => {},
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json({
            provider: 'claude_code',
            locked: false,
            web_search: false,
          }),
        ),
      ),
    )

    await mountSettingsScreen()

    expect(host?.querySelector('[role="alert"]')?.textContent).toEqual(
      'Settings could not be loaded from this device.',
    )
  })

  it('shows a save error when local settings cannot be written', async () => {
    setLocalStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable')
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json({
            provider: 'claude_code',
            locked: false,
            web_search: false,
          }),
        ),
      ),
    )

    await mountSettingsScreen()

    const localButton = [...(host?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Local',
    )
    act(() => {
      localButton?.click()
    })

    const readScreenOutput = () => ({
      localRoute: localButton?.textContent,
      alert: host?.querySelector('[role="alert"]')?.textContent,
    })

    expect(readScreenOutput()).toEqual({
      localRoute: 'Local',
      alert: 'Settings could not be saved on this device.',
    })
  })
})
