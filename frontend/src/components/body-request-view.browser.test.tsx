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
  })

  it('moves the open popup when its anchor element changes', async () => {
    const firstAnchor = createAnchor(300)
    renderView(firstAnchor)
    await vi.waitFor(() => {
      expect(readPopupTop()).toEqual(324)
    })

    const secondAnchor = createAnchor(100)
    renderView(secondAnchor)
    await vi.waitFor(() => {
      expect(readPopupTop()).toEqual(124)
    })
  })
})
