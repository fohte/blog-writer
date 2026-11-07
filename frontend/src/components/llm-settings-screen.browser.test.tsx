import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { LlmSettingsScreen } from '#components/llm-settings-screen'

const routeKey = 'blog-writer.llm.route'
const bridgeUrlKey = 'blog-writer.llm.bridge-url'

let host: HTMLDivElement | undefined
let root: Root | undefined
let localStorageDescriptor: PropertyDescriptor | undefined
let storedValues = new Map<string, string>()

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

const stubMemoryStorage = (initial: Record<string, string> = {}) => {
  storedValues = new Map(Object.entries(initial))
  setLocalStorage({
    getItem: (key) => storedValues.get(key) ?? null,
    setItem: (key, value) => {
      storedValues.set(key, value)
    },
  })
}

const statusResponse = (locked: boolean) =>
  Response.json({ provider: 'claude_code', locked, web_search: false })

const stubFetch = ({
  locked = false,
  bridgeReachable = true,
}: {
  locked?: boolean
  bridgeReachable?: boolean
} = {}) => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input) => {
      if (input === '/api/llm/status')
        return Promise.resolve(statusResponse(locked))
      return bridgeReachable
        ? Promise.resolve(statusResponse(false))
        : Promise.reject(new TypeError('Failed to fetch'))
    }),
  )
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

const mountSettingsScreen = async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  act(() => {
    root?.render(<LlmSettingsScreen onBack={() => {}} />)
  })

  await settle()
}

const clickButton = (name: string) =>
  act(async () => {
    await userEvent.click(page.getByRole('button', { name, exact: true }))
  })

const fillBridgeUrl = (value: string) =>
  act(async () => {
    await userEvent.fill(
      page.getByRole('textbox', { name: '中継の URL' }),
      value,
    )
  })

const readScreenOutput = () => ({
  routes: [...(host?.querySelectorAll('[role="group"] button') ?? [])].map(
    (button) =>
      button.getAttribute('aria-pressed') === 'true'
        ? `${button.textContent} (selected)`
        : button.textContent,
  ),
  bridgeUrl: host?.querySelector<HTMLInputElement>('#bridge-url')?.value,
  messages: [
    ...(host?.querySelectorAll('[role="alert"], [role="status"]') ?? []),
  ].map((message) => message.textContent),
  stored: Object.fromEntries(storedValues),
})

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
  storedValues = new Map()

  if (localStorageDescriptor) {
    Object.defineProperty(window, 'localStorage', localStorageDescriptor)
    localStorageDescriptor = undefined
  }

  vi.unstubAllGlobals()
})

describe('LlmSettingsScreen', () => {
  it('keeps an edited route unsaved until the save button is pressed', async () => {
    stubMemoryStorage()
    stubFetch()
    await mountSettingsScreen()

    await clickButton('ローカル (この PC の中継)')
    await fillBridgeUrl('http://127.0.0.1:4000')

    expect(readScreenOutput()).toEqual({
      routes: ['サーバー (既定)', 'ローカル (この PC の中継) (selected)'],
      bridgeUrl: 'http://127.0.0.1:4000',
      messages: ['未保存の変更あり'],
      stored: {},
    })
  })

  it('saves the edited route on this device', async () => {
    stubMemoryStorage()
    stubFetch()
    await mountSettingsScreen()

    await clickButton('ローカル (この PC の中継)')
    await fillBridgeUrl('http://127.0.0.1:4000')
    await clickButton('保存')
    await settle()

    expect(readScreenOutput()).toEqual({
      routes: ['サーバー (既定)', 'ローカル (この PC の中継) (selected)'],
      bridgeUrl: 'http://127.0.0.1:4000',
      messages: ['保存済み'],
      stored: { [routeKey]: 'local', [bridgeUrlKey]: 'http://127.0.0.1:4000' },
    })
  })

  it('shows that the saved bridge URL cannot be reached', async () => {
    stubMemoryStorage({
      [routeKey]: 'local',
      [bridgeUrlKey]: 'http://127.0.0.1:4000',
    })
    stubFetch({ bridgeReachable: false })
    await mountSettingsScreen()

    expect(readScreenOutput()).toEqual({
      routes: ['サーバー (既定)', 'ローカル (この PC の中継) (selected)'],
      bridgeUrl: 'http://127.0.0.1:4000',
      messages: ['! 接続できません', '保存済み'],
      stored: { [routeKey]: 'local', [bridgeUrlKey]: 'http://127.0.0.1:4000' },
    })
  })

  it('hides the connection error while another bridge URL is edited', async () => {
    stubMemoryStorage({
      [routeKey]: 'local',
      [bridgeUrlKey]: 'http://127.0.0.1:4000',
    })
    stubFetch({ bridgeReachable: false })
    await mountSettingsScreen()

    await fillBridgeUrl('http://127.0.0.1:5000')

    expect(readScreenOutput()).toEqual({
      routes: ['サーバー (既定)', 'ローカル (この PC の中継) (selected)'],
      bridgeUrl: 'http://127.0.0.1:5000',
      messages: ['未保存の変更あり'],
      stored: { [routeKey]: 'local', [bridgeUrlKey]: 'http://127.0.0.1:4000' },
    })
  })

  it('hides the route controls when the environment fixes the route', async () => {
    stubMemoryStorage()
    stubFetch({ locked: true })
    await mountSettingsScreen()

    expect(readScreenOutput()).toEqual({
      routes: [],
      bridgeUrl: undefined,
      messages: [],
      stored: {},
    })
  })

  it('shows a load error when local settings cannot be read', async () => {
    setLocalStorage({
      getItem: () => {
        throw new Error('storage unavailable')
      },
      setItem: () => {},
    })
    stubFetch()
    await mountSettingsScreen()

    expect(readScreenOutput()).toEqual({
      routes: ['サーバー (既定) (selected)', 'ローカル (この PC の中継)'],
      bridgeUrl: undefined,
      messages: ['この端末から設定を読み込めませんでした。', '保存済み'],
      stored: {},
    })
  })

  it('shows a save error when local settings cannot be written', async () => {
    setLocalStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable')
      },
    })
    stubFetch()
    await mountSettingsScreen()

    await clickButton('ローカル (この PC の中継)')
    await clickButton('保存')

    expect(readScreenOutput()).toEqual({
      routes: ['サーバー (既定)', 'ローカル (この PC の中継) (selected)'],
      bridgeUrl: '',
      messages: ['この端末に設定を保存できませんでした。', '未保存の変更あり'],
      stored: {},
    })
  })
})
