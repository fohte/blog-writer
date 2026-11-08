import { type EditorState, Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { DomWidget } from '#editor/dom-widget'

export interface BlockWidgetDecorator {
  decorate: (
    element: HTMLElement,
    view: EditorView,
    sourceFrom: number,
  ) => (() => void) | undefined
  identity: (state: EditorState, sourceFrom: number) => string
}

interface BlockWidgetOptions {
  attachDecorators?: boolean
  state: EditorState
  sourceFrom: number
}

const decoratorCleanupsByElement = new WeakMap<HTMLElement, (() => void)[]>()
const cleanupByElement = new WeakMap<HTMLElement, () => void>()

export const blockWidgetDecorators = Facet.define<
  BlockWidgetDecorator,
  readonly BlockWidgetDecorator[]
>({ combine: (decorators) => decorators })

export function createBlockWidget(
  createPreview: (view: EditorView) => HTMLElement,
  identity: string,
  { attachDecorators = true, sourceFrom, state }: BlockWidgetOptions,
): DomWidget {
  const equalityKey = attachDecorators
    ? String(sourceFrom) +
      '\u0000' +
      state
        .facet(blockWidgetDecorators)
        .map((decorator) => decorator.identity(state, sourceFrom))
        .join('\u0000')
    : identity
  const refreshDecorators = (element: HTMLElement, view: EditorView) => {
    for (const cleanup of decoratorCleanupsByElement.get(element) ?? [])
      cleanup()
    const cleanups = attachDecorators
      ? view.state
          .facet(blockWidgetDecorators)
          .map((decorator) => decorator.decorate(element, view, sourceFrom))
          .filter((cleanup): cleanup is () => void => cleanup !== undefined)
      : []
    decoratorCleanupsByElement.set(element, cleanups)
    return true
  }
  return new DomWidget(
    (view) => {
      const element = document.createElement('div')
      element.className = 'cm-markdown-block-widget'
      element.append(createPreview(view))

      refreshDecorators(element, view)
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
        for (const cleanup of decoratorCleanupsByElement.get(element) ?? [])
          cleanup()
        decoratorCleanupsByElement.delete(element)
      })
      return element
    },
    identity,
    {
      destroyElement: (element) => {
        cleanupByElement.get(element)?.()
        cleanupByElement.delete(element)
      },
      equalityKey,
      shouldIgnoreEvent: (event) => {
        if (
          event.type === 'drop' &&
          event instanceof DragEvent &&
          (event.dataTransfer?.files.length ?? 0) > 0
        ) {
          return false
        }
        if (!(event.target instanceof Element)) return false

        const widget = event.target.closest('.cm-markdown-block-widget')
        const interactive = event.target.closest(
          'a, button, input, select, textarea, [tabindex], .cm-markdown-block-widget-handle',
        )
        return (
          widget !== null &&
          interactive !== null &&
          widget.contains(interactive)
        )
      },
      updateElement: attachDecorators ? refreshDecorators : undefined,
    },
  )
}
