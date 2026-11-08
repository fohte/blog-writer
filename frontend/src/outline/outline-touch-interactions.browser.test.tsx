import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'

import { createBodyMenuEditor } from '#outline/body-menu-editor.test-support.test'

declare module 'vitest/browser' {
  interface BrowserCommands {
    tapBodyElement: (selector: string) => Promise<void>
  }
}

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  cleanups.length = 0
})

describe('body move handle touch interactions', () => {
  it('opens the body move menu after a touchscreen tap', async () => {
    const markdownText = 'First paragraph.\n\nSecond paragraph.\n'
    const { body, cleanup, view } = createBodyMenuEditor(markdownText)
    cleanups.push(cleanup)
    const handle = view.dom.querySelector<HTMLButtonElement>(
      '.cm-block-drag-handle',
    )
    if (!handle) throw new Error('The first body move handle is missing')

    await act(async () => {
      await commands.tapBodyElement('.cm-block-drag-handle')
    })

    const currentHandle = view.dom.querySelector<HTMLButtonElement>(
      '.cm-block-drag-handle',
    )
    const menuItems = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].map((item) => ({ label: item.textContent, disabled: item.disabled }))
    const readOutput = () => ({
      body: body.toJSON(),
      editor: view.state.doc.toString(),
      expanded: currentHandle?.getAttribute('aria-expanded') ?? null,
      menuItems,
    })
    expect(readOutput()).toEqual({
      body: markdownText,
      editor: markdownText,
      expanded: 'true',
      menuItems: [
        { label: 'Move up', disabled: true },
        { label: 'Move down', disabled: false },
      ],
    })
  })
})
