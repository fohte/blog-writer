import type { EditorView } from '@codemirror/view'
import { act } from 'react'
import { userEvent } from 'vitest/browser'

function modifierKey() {
  return navigator.platform.includes('Mac') ? 'Meta' : 'Control'
}

export async function pressUndo(view: EditorView) {
  view.focus()
  const modifier = modifierKey()
  await act(async () => {
    await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`)
  })
}

export async function pressRedo(view: EditorView) {
  view.focus()
  const modifier = modifierKey()
  await act(async () => {
    await userEvent.keyboard(`{${modifier}>}{Shift>}z{/Shift}{/${modifier}}`)
  })
}
