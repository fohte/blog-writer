import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BodyRequestView } from '#components/body-request-view'

let host: HTMLDivElement
let anchors: HTMLDivElement
let root: Root

function createAnchor(top: number) {
  const anchor = document.createElement('div')
  anchor.style.position = 'fixed'
  anchor.style.top = `${String(top)}px`
  anchor.style.height = '20px'
  anchor.style.width = '100px'
  anchors.append(anchor)
  return anchor
}

function renderView(anchor: HTMLElement) {
  act(() => {
    root.render(
      <BodyRequestView
        anchor={anchor}
        instruction=""
        onInstructionChange={() => {}}
        onOpenChange={() => {}}
        onSubmit={() => {}}
        open
        phase="input"
        target="selection"
        touchDevice={false}
      />,
    )
  })
}

function readPopupTop() {
  return document
    .querySelector('[data-slot="popover-content"]')
    ?.getBoundingClientRect().top
}

describe('BodyRequestView', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div')
    anchors = document.createElement('div')
    document.body.append(host, anchors)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    anchors.remove()
    vi.unstubAllGlobals()
  })

  it('moves the open popup when its anchor element changes', async () => {
    const waitForPopupTop = (top: number) =>
      vi.waitFor(() => {
        if (readPopupTop() !== top) throw new Error('The popup did not settle')
      })
    renderView(createAnchor(300))
    await waitForPopupTop(324)
    const initialTop = readPopupTop()

    renderView(createAnchor(100))
    await waitForPopupTop(124)

    const readResult = () => ({ initialTop, movedTop: readPopupTop() })
    expect(readResult()).toEqual({ initialTop: 324, movedTop: 124 })
  })
})
