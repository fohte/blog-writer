import { type EditorView, WidgetType } from '@codemirror/view'

interface DomWidgetOptions {
  destroyElement?: ((dom: HTMLElement) => void) | undefined
  equalityKey?: unknown
  shouldIgnoreEvent?: ((event: Event) => boolean) | undefined
  updateElement?: ((dom: HTMLElement, view: EditorView) => boolean) | undefined
}

export class DomWidget extends WidgetType {
  private readonly destroyElement: ((dom: HTMLElement) => void) | undefined
  private readonly equalityKey: unknown
  private readonly shouldIgnoreEvent: ((event: Event) => boolean) | undefined
  private readonly updateElement:
    ((dom: HTMLElement, view: EditorView) => boolean) | undefined

  constructor(
    private readonly createElement: (view: EditorView) => HTMLElement,
    private readonly identity: string,
    options: DomWidgetOptions = {},
  ) {
    super()
    this.destroyElement = options.destroyElement
    this.equalityKey = options.equalityKey ?? identity
    this.shouldIgnoreEvent = options.shouldIgnoreEvent
    this.updateElement = options.updateElement
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof DomWidget &&
      other.identity === this.identity &&
      other.equalityKey === this.equalityKey
    )
  }

  override updateDOM(dom: HTMLElement, view: EditorView, from: this): boolean {
    return (
      from.identity === this.identity &&
      (this.updateElement?.(dom, view) ?? false)
    )
  }

  override ignoreEvent(event: Event): boolean {
    return this.shouldIgnoreEvent?.(event) ?? false
  }

  override toDOM(view: EditorView): HTMLElement {
    return this.createElement(view)
  }

  override destroy(dom: Node): void {
    if (dom instanceof HTMLElement) this.destroyElement?.(dom)
  }
}
