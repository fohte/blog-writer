import { type EditorView, WidgetType } from '@codemirror/view'

export class DomWidget extends WidgetType {
  constructor(
    private readonly createElement: (view: EditorView) => HTMLElement,
    private readonly identity: string,
    private readonly destroyElement?: (dom: HTMLElement) => void,
    private readonly shouldIgnoreEvent?: (event: Event) => boolean,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return other instanceof DomWidget && other.identity === this.identity
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
