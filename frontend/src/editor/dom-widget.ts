import { type EditorView, WidgetType } from '@codemirror/view'

export class DomWidget extends WidgetType {
  constructor(
    private readonly createElement: (view: EditorView) => HTMLElement,
    private readonly identity: string,
    private readonly destroyElement?: (dom: HTMLElement) => void,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return other instanceof DomWidget && other.identity === this.identity
  }

  override ignoreEvent(): boolean {
    return false
  }

  override toDOM(view: EditorView): HTMLElement {
    return this.createElement(view)
  }

  override destroy(dom: Node): void {
    if (dom instanceof HTMLElement) this.destroyElement?.(dom)
  }
}
