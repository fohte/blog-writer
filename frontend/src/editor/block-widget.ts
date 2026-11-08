import { Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { DomWidget } from '#editor/dom-widget'

export type BlockWidgetDecorator = (
  element: HTMLElement,
  view: EditorView,
  sourceFrom: number,
) => (() => void) | undefined

interface BlockWidgetOptions {
  attachDecorators?: boolean
  sourceFrom: number
}

export const blockWidgetDecorators = Facet.define<
  BlockWidgetDecorator,
  readonly BlockWidgetDecorator[]
>({ combine: (decorators) => decorators })

export function createBlockWidget(
  createPreview: (view: EditorView) => HTMLElement,
  identity: string,
  { attachDecorators = true, sourceFrom }: BlockWidgetOptions,
): DomWidget {
  const cleanupByElement = new WeakMap<HTMLElement, () => void>()
  const widgetIdentity = attachDecorators
    ? `${identity}:${String(sourceFrom)}`
    : identity
  return new DomWidget(
    (view) => {
      const element = document.createElement('div')
      element.className = 'cm-markdown-block-widget'
      element.append(createPreview(view))

      const cleanups = attachDecorators
        ? view.state
            .facet(blockWidgetDecorators)
            .map((decorate) => decorate(element, view, sourceFrom))
            .filter((cleanup): cleanup is () => void => cleanup !== undefined)
        : []
      const stopWidgetMouseDown = (event: MouseEvent) => {
        event.stopPropagation()
      }
      const enterSource = (event: MouseEvent) => {
        const target = event.target
        if (
          target instanceof Element &&
          target.closest('a, .cm-markdown-block-widget-handle')
        ) {
          event.stopPropagation()
          return
        }

        event.preventDefault()
        event.stopPropagation()
        const first = view.posAtDOM(element, -1)
        const last = view.posAtDOM(element, 1)
        const from = Math.min(first, last)
        const to = Math.max(first, last)
        view.focus()
        view.dispatch({
          selection: { anchor: Math.min(from + 1, to) },
          scrollIntoView: true,
        })
      }
      element.addEventListener('mousedown', stopWidgetMouseDown)
      element.addEventListener('click', enterSource)
      cleanupByElement.set(element, () => {
        element.removeEventListener('mousedown', stopWidgetMouseDown)
        element.removeEventListener('click', enterSource)
        for (const cleanup of cleanups) cleanup()
      })
      return element
    },
    widgetIdentity,
    (element) => {
      cleanupByElement.get(element)?.()
      cleanupByElement.delete(element)
    },
    (event) =>
      event.type === 'keydown' &&
      event.target instanceof Element &&
      event.target.closest('.cm-markdown-block-widget-handle') !== null,
  )
}
