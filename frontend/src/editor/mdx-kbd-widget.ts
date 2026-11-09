import { createMdxKbdPreview } from '#components/mdx-kbd-preview'
import { DomWidget } from '#editor/dom-widget'

export function createMdxKbdWidget(value: string): DomWidget {
  return new DomWidget((view) => {
    const key = createMdxKbdPreview({ value })
    key.addEventListener('mousedown', (event) => {
      event.stopPropagation()
    })
    key.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const from = view.posAtDOM(key, -1)
      const to = view.posAtDOM(key, 1)
      view.focus()
      view.dispatch({ selection: { anchor: Math.min(from + 1, to) } })
    })
    return key
  }, `mdx-kbd:${value}`)
}
