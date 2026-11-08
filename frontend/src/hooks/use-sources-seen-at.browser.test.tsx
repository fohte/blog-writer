import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSourcesSeenAt } from '#hooks/use-sources-seen-at'

const articleId = 'article-seen-test'
const key = `blog-writer.sources-seen-at.${articleId}`
const firstLeave = '2026-01-01T00:00:00.000Z'
const secondLeave = '2026-01-02T00:00:00.000Z'

let root: Root
let seenAt: string | null

function Harness({ id, visible }: { id: string; visible: boolean }) {
  seenAt = useSourcesSeenAt(id, visible)
  return null
}

const render = (visible: boolean, id = articleId) => {
  act(() => {
    root.render(createElement(Harness, { id, visible }))
  })
}

const read = () => ({ seenAt, stored: window.localStorage.getItem(key) })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(firstLeave)
  window.localStorage.removeItem(key)
  root = createRoot(document.createElement('div'))
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  window.localStorage.removeItem(key)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useSourcesSeenAt', () => {
  it('has no time before the tab was ever opened', () => {
    render(false)

    expect(read()).toEqual({ seenAt: null, stored: null })
  })

  it('remembers the time the tab was left', () => {
    render(true)
    render(false)

    expect(read()).toEqual({ seenAt: null, stored: firstLeave })
  })

  it('keeps the earlier time while the tab stays open', () => {
    render(true)
    render(false)
    vi.setSystemTime(secondLeave)
    render(true)

    expect(read()).toEqual({ seenAt: firstLeave, stored: firstLeave })
  })

  it('moves on to the later time on the next visit', () => {
    render(true)
    render(false)
    vi.setSystemTime(secondLeave)
    render(true)
    render(false)
    render(true)

    expect(read()).toEqual({ seenAt: secondLeave, stored: secondLeave })
  })

  it('remembers the time when the page closes with the tab open', () => {
    render(true)
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(read()).toEqual({ seenAt: null, stored: firstLeave })
  })
})
