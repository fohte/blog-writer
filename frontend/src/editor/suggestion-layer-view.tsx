import type { EditorState } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  WidgetType,
} from '@codemirror/view'
import { useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { SuggestionDiff } from '#components/suggestion-diff'
import { SuggestionGeneratingBar } from '#components/suggestion-generating-bar'
import type {
  InFlightSuggestion,
  SuggestionLayerState,
  TextSuggestion,
} from '#editor/suggestion-layer'

const rootsByDOM = new WeakMap<HTMLElement, Root>()

interface SuggestionControllerActions {
  accept(id: string): void
  cancelInFlight(): boolean
  readonly inFlightCancellable: boolean
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

export function createSuggestionDecorations<Metadata = unknown>(
  state: SuggestionLayerState<Metadata>,
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
    const { from, to } = state.inFlight
    if (from < to) {
      decorations.push(
        Decoration.mark({ class: 'cm-suggestion-in-flight-target' }).range(
          from,
          to,
        ),
      )
    }
    decorations.push(
      Decoration.widget({
        block: true,
        side: 1,
        widget: new SuggestionDiffWidget(
          null,
          state.inFlight,
          '',
          false,
          true,
          controller,
        ),
      }).range(editorState.doc.lineAt(to).to),
    )
  }

  return Decoration.set(decorations, true)
}

function InFlightBar({
  label,
  onCancel,
}: {
  label: string | undefined
  onCancel: (() => void) | undefined
}) {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  return (
    <SuggestionGeneratingBar
      elapsedSeconds={Math.floor((now - startedAt) / 1000)}
      label={label}
      onCancel={onCancel}
    />
  )
}

class SuggestionDiffWidget extends WidgetType {
  constructor(
    readonly suggestion: TextSuggestion | null,
    readonly position: InFlightSuggestion,
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
      other.suggestion?.note === this.suggestion?.note &&
      other.original === this.original &&
      other.position.label === this.position.label &&
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
          {...(suggestion.replacementMarks === undefined
            ? {}
            : { replacementMarks: suggestion.replacementMarks })}
          {...(suggestion.note === undefined ? {} : { note: suggestion.note })}
        />
      ) : (
        <InFlightBar
          label={this.position.label}
          onCancel={
            this.controller.inFlightCancellable
              ? () => {
                  this.controller.cancelInFlight()
                }
              : undefined
          }
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
