import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MoveConflictNotice } from '#components/move-conflict-notice'

let host: HTMLDivElement | undefined
let root: Root | undefined

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
  vi.unstubAllGlobals()
})

describe('MoveConflictNotice', () => {
  it.each([
    ['移動先へ移す', { move: 1, keep: 0 }],
    ['その場に残す', { move: 0, keep: 1 }],
  ] as const)('calls only the selected action: %s', (label, expected) => {
    const calls = { move: vi.fn(), keep: vi.fn() }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    act(() => {
      root?.render(
        <MoveConflictNotice
          onKeep={calls.keep}
          onMove={calls.move}
          text="A sentence remains here."
        />,
      )
    })

    const button = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label,
    )
    act(() => {
      button?.click()
    })

    const readCalls = () => ({
      move: calls.move.mock.calls.length,
      keep: calls.keep.mock.calls.length,
    })
    expect(readCalls()).toEqual(expected)
  })
})
