import type { EditorState } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  WidgetType,
} from '@codemirror/view'
import { createRoot, type Root } from 'react-dom/client'

import { SuggestionDiff } from '#components/suggestion-diff'
import type {
  SuggestionLayerState,
  SuggestionPosition,
  TextSuggestion,
} from '#editor/suggestion-layer'

const rootsByDOM = new WeakMap<HTMLElement, Root>()

interface SuggestionControllerActions {
  accept(id: string): void
  focus(id: string): void
  reject(id: string): void
}

function isFullLineRange(
  doc: EditorState['doc'],
  from: number,
  to: number,
): boolean {
  if (from === to) return false
  const startLine = doc.lineAt(from)
  const endLine = doc.lineAt(to)
  return (
    from === startLine.from &&
    (to === endLine.to ||
      (endLine.number > startLine.number && to === endLine.from))
  )
}

export function createSuggestionDecorations(
  state: SuggestionLayerState,
  editorState: EditorState,
  controller: SuggestionControllerActions,
): DecorationSet {
  const decorations = state.suggestions.map((suggestion) => {
    const block = isFullLineRange(
      editorState.doc,
      suggestion.from,
      suggestion.to,
    )
    const widget = new SuggestionDiffWidget(
      suggestion,
      { from: suggestion.from, to: suggestion.to },
      editorState.doc.sliceString(suggestion.from, suggestion.to),
      suggestion.id === state.focusedId,
      block,
      controller,
    )
    if (suggestion.from === suggestion.to) {
      return Decoration.widget({ widget, side: 1 }).range(suggestion.from)
    }
    return Decoration.replace({ block, widget }).range(
      suggestion.from,
      suggestion.to,
    )
  })

  if (state.inFlight) {
    const block = isFullLineRange(
      editorState.doc,
      state.inFlight.from,
      state.inFlight.to,
    )
    decorations.push(
      Decoration.widget({
        block,
        side: 1,
        widget: new SuggestionDiffWidget(
          null,
          state.inFlight,
          '',
          false,
          block,
          controller,
        ),
      }).range(state.inFlight.from),
    )
  }

  return Decoration.set(decorations, true)
}

class SuggestionDiffWidget extends WidgetType {
  constructor(
    readonly suggestion: TextSuggestion | null,
    readonly position: SuggestionPosition,
    readonly original: string,
    readonly focused: boolean,
    readonly block: boolean,
    private readonly controller: SuggestionControllerActions,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof SuggestionDiffWidget &&
      this.sameContent(other) &&
      other.position.from === this.position.from &&
      other.position.to === this.position.to
    )
  }

  override updateDOM(dom: HTMLElement, _view: EditorView, from: this): boolean {
    if (!this.sameContent(from)) return false
    dom.dataset['suggestionFrom'] = String(this.position.from)
    dom.dataset['suggestionTo'] = String(this.position.to)
    return true
  }

  private sameContent(other: SuggestionDiffWidget): boolean {
    return (
      other.suggestion?.id === this.suggestion?.id &&
      other.suggestion?.replacement === this.suggestion?.replacement &&
      other.original === this.original &&
      other.focused === this.focused &&
      other.block === this.block
    )
  }

  override toDOM(): HTMLElement {
    const dom = document.createElement(this.block ? 'div' : 'span')
    dom.className = 'cm-suggestion-widget'
    dom.dataset['suggestionFrom'] = String(this.position.from)
    dom.dataset['suggestionTo'] = String(this.position.to)
    const root = createRoot(dom)
    const suggestion = this.suggestion
    rootsByDOM.set(dom, root)
    root.render(
      suggestion ? (
        <SuggestionDiff
          focused={this.focused}
          inline={!this.block}
          {...(this.focused
            ? {
                onAccept: () => {
                  this.controller.accept(suggestion.id)
                },
                onReject: () => {
                  this.controller.reject(suggestion.id)
                },
              }
            : {})}
          original={this.original}
          replacement={suggestion.replacement}
          {...(suggestion.note === undefined ? {} : { note: suggestion.note })}
        />
      ) : (
        <SuggestionDiff
          generating
          inline={!this.block}
          original=""
          replacement=""
        />
      ),
    )
    dom.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('button')) {
        return
      }
      if (suggestion) this.controller.focus(suggestion.id)
    })
    return dom
  }

  override destroy(dom: HTMLElement): void {
    const root = rootsByDOM.get(dom)
    rootsByDOM.delete(dom)
    if (root) {
      queueMicrotask(() => {
        root.unmount()
      })
    }
  }

  override ignoreEvent(): boolean {
    return true
  }
}
