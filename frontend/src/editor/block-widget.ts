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

type BlockWidgetSourceRange = Readonly<{ from: number; to: number }>

interface BlockWidgetOptions {
  attachDecorators?: boolean
  state: EditorState
  sourceFrom: number
  sourceRange: BlockWidgetSourceRange
}

const decoratorCleanupsByElement = new WeakMap<HTMLElement, (() => void)[]>()
const cleanupByElement = new WeakMap<HTMLElement, () => void>()

export const blockWidgetDecorators = Facet.define<
  BlockWidgetDecorator,
  readonly BlockWidgetDecorator[]
>({ combine: (decorators) => decorators })

export function getBlockWidgetDOMRange(
  view: EditorView,
  element: HTMLElement,
): BlockWidgetSourceRange {
  const first = view.posAtDOM(element, -1)
  const last = view.posAtDOM(element, 1)
  return { from: Math.min(first, last), to: Math.max(first, last) }
}

export function createBlockWidget(
  createPreview: (view: EditorView) => HTMLElement,
  identity: string,
  {
    attachDecorators = true,
    sourceFrom,
    sourceRange,
    state,
  }: BlockWidgetOptions,
): DomWidget {
  const equalityKey = attachDecorators
    ? String(sourceRange.from) +
      '\u0000' +
      String(sourceRange.to) +
      '\u0000' +
      String(sourceFrom) +
      '\u0000' +
      state
        .facet(blockWidgetDecorators)
        .map((decorator) => decorator.identity(state, sourceFrom))
        .join('\u0000')
    : String(sourceRange.from) + '\u0000' + String(sourceRange.to)
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
        const { from, to } = getBlockWidgetDOMRange(view, element)
        view.focus()
        view.dispatch({
          selection: { anchor: Math.min(from + 1, to) },
          scrollIntoView: true,
        })
      }
      const allowFileDrop = (event: DragEvent) => {
        if (event.dataTransfer?.types.includes('Files') === true)
          event.preventDefault()
      }
      element.addEventListener('mousedown', stopWidgetMouseDown)
      element.addEventListener('click', enterSource)
      element.addEventListener('dragover', allowFileDrop)
      cleanupByElement.set(element, () => {
        element.removeEventListener('mousedown', stopWidgetMouseDown)
        element.removeEventListener('click', enterSource)
        element.removeEventListener('dragover', allowFileDrop)
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
        const isFileDrop =
          event.type === 'drop' &&
          event instanceof DragEvent &&
          (event.dataTransfer?.files.length ?? 0) > 0
        if (isFileDrop) {
          const files = [...(event.dataTransfer?.files ?? [])]
          if (files.some((file) => file.type.startsWith('image/'))) return false
          if (
            event.target instanceof Element &&
            event.target.closest('.cm-markdown-block-widget')
          ) {
            event.preventDefault()
            return true
          }
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
