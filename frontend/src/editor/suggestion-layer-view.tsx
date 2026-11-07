import type { EditorState, Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view'
import { type ReactNode, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { SuggestionActionBar } from '#components/suggestion-action-bar'
import { SuggestionDiff } from '#components/suggestion-diff'
import { SuggestionGeneratingBar } from '#components/suggestion-generating-bar'
import type {
  InFlightSuggestion,
  SuggestionLayerState,
  SuggestionPosition,
  TextSuggestion,
} from '#editor/suggestion-layer-range'

/** `seam` collapses each suggestion into a divider after the line where it starts. */
export type SuggestionDisplay = 'marker' | 'seam'

const rootsByDOM = new WeakMap<HTMLElement, Root>()

interface SuggestionControllerActions {
  accept(id: string): void
  cancelInFlight(): boolean
  readonly inFlightCancellable: boolean
  focus(id: string): void
  reject(id: string): void
}

export const suggestionLayerTheme = EditorView.baseTheme({
  '.cm-suggestion-widget': {
    whiteSpace: 'normal',
  },
  '.cm-suggestion-in-flight-target': {
    textDecoration: 'underline dotted var(--muted-foreground)',
    textUnderlineOffset: '5px',
  },
  '.cm-suggestion-target': {
    textDecoration: 'underline dotted var(--tint-green-foreground)',
    textUnderlineOffset: '5px',
  },
  '.cm-content > .cm-suggestion-widget, .cm-content > .cm-suggestion-actions, .cm-content > .cm-suggestion-seam':
    {
      marginInlineStart: 'var(--cm-line-inset, 0px)',
    },
  '.cm-suggestion-focused-line, .cm-suggestion-block': {
    outline: '1px solid var(--border)',
    outlineOffset: '8px',
  },
  '.cm-suggestion-marker-line': {
    position: 'relative',
  },
  // Sits left of the whole line box so it stays clear of anything in the line's start padding, such as a block drag handle.
  '.cm-suggestion-marker': {
    position: 'absolute',
    right: 'calc(100% + 0.25rem)',
    top: '50%',
    transform: 'translateY(-50%)',
    border: '1px solid var(--tint-green-foreground)',
    background: 'transparent',
    color: 'var(--tint-green-foreground)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    lineHeight: '18px',
    padding: '0 4px',
    whiteSpace: 'nowrap',
  },
  '.cm-suggestion-seam': {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '4px 0',
  },
  '.cm-suggestion-seam::before, .cm-suggestion-seam::after': {
    content: '""',
    flex: '1',
    borderTop: '1px dashed var(--border)',
  },
  '.cm-suggestion-seam-button': {
    border: '1px dashed var(--tint-green-foreground)',
    background: 'transparent',
    color: 'var(--tint-green-foreground)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    lineHeight: '1.6',
    padding: '2px 10px',
  },
})

const targetMark = Decoration.mark({ class: 'cm-suggestion-target' })
const focusedLine = Decoration.line({ class: 'cm-suggestion-focused-line' })
const markerLine = Decoration.line({ class: 'cm-suggestion-marker-line' })
const inFlightTargetMark = Decoration.mark({
  class: 'cm-suggestion-in-flight-target',
})

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
  display: SuggestionDisplay,
): DecorationSet {
  const { doc } = editorState
  const decorations: Range<Decoration>[] = []
  const linesWithMarker = new Set<number>()

  for (const suggestion of state.suggestions) {
    const { from, to } = suggestion
    if (suggestion.id === state.focusedId) {
      decorations.push(
        ...focusedDecorations(suggestion, doc, controller, display),
      )
    } else if (display === 'seam') {
      decorations.push(
        Decoration.widget({
          block: true,
          side: 1,
          widget: new SuggestionOpenerWidget(
            suggestion.id,
            display,
            controller,
          ),
        }).range(doc.lineAt(from).to),
      )
    } else {
      if (from < to) decorations.push(targetMark.range(from, to))
      const lineStart = doc.lineAt(from).from
      if (!linesWithMarker.has(lineStart)) {
        linesWithMarker.add(lineStart)
        decorations.push(
          markerLine.range(lineStart),
          Decoration.widget({
            side: -1,
            widget: new SuggestionOpenerWidget(
              suggestion.id,
              display,
              controller,
            ),
          }).range(lineStart),
        )
      }
    }
  }

  if (state.inFlight) {
    const { from, to } = state.inFlight
    if (from < to) decorations.push(inFlightTargetMark.range(from, to))
    decorations.push(
      Decoration.widget({
        block: true,
        side: 1,
        widget: new InFlightWidget(state.inFlight, controller),
      }).range(doc.lineAt(to).to),
    )
  }

  return Decoration.set(decorations, true)
}

function focusedDecorations(
  suggestion: TextSuggestion,
  doc: EditorState['doc'],
  controller: SuggestionControllerActions,
  display: SuggestionDisplay,
): Range<Decoration>[] {
  const { from, to } = suggestion
  const block = isFullLineRange(doc, from, to)
  const diff = new SuggestionDiffWidget(
    suggestion,
    doc.sliceString(from, to),
    block,
    controller,
  )
  const endLine = doc.lineAt(to)
  // A block range ending at a line start would otherwise put the actions after the next line.
  const actionsBeforeLine = block && to === endLine.from
  const target =
    from === to ? '挿入' : block ? '段落を置き換え' : '選択範囲を置き換え'

  return [
    from === to
      ? Decoration.widget({ widget: diff, side: 1 }).range(from)
      : Decoration.replace({ block, widget: diff }).range(from, to),
    ...(block ? [] : [focusedLine.range(doc.lineAt(from).from)]),
    Decoration.widget({
      block: true,
      side: actionsBeforeLine ? -1 : 1,
      widget: new SuggestionActionsWidget(
        suggestion,
        target,
        display,
        controller,
      ),
    }).range(actionsBeforeLine ? to : endLine.to),
  ]
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

function setRangeData(dom: HTMLElement, { from, to }: SuggestionPosition) {
  dom.dataset['suggestionFrom'] = String(from)
  dom.dataset['suggestionTo'] = String(to)
}

abstract class ReactWidget extends WidgetType {
  protected abstract createDOM(): HTMLElement
  protected abstract render(): ReactNode

  override toDOM(): HTMLElement {
    const dom = this.createDOM()
    const root = createRoot(dom)
    rootsByDOM.set(dom, root)
    root.render(this.render())
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

class SuggestionDiffWidget extends ReactWidget {
  constructor(
    readonly suggestion: TextSuggestion,
    readonly original: string,
    readonly block: boolean,
    private readonly controller: SuggestionControllerActions,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof SuggestionDiffWidget &&
      this.sameContent(other) &&
      other.suggestion.from === this.suggestion.from &&
      other.suggestion.to === this.suggestion.to
    )
  }

  override updateDOM(dom: HTMLElement, _view: EditorView, from: this): boolean {
    if (!this.sameContent(from)) return false
    setRangeData(dom, this.suggestion)
    return true
  }

  private sameContent(other: SuggestionDiffWidget): boolean {
    return (
      other.suggestion.id === this.suggestion.id &&
      other.suggestion.replacement === this.suggestion.replacement &&
      other.original === this.original &&
      other.block === this.block
    )
  }

  protected createDOM(): HTMLElement {
    const dom = document.createElement(this.block ? 'div' : 'span')
    dom.className = this.block
      ? 'cm-suggestion-widget cm-suggestion-block'
      : 'cm-suggestion-widget'
    setRangeData(dom, this.suggestion)
    dom.addEventListener('click', () => {
      this.controller.focus(this.suggestion.id)
    })
    return dom
  }

  protected render(): ReactNode {
    const { replacement, replacementMarks } = this.suggestion
    return (
      <SuggestionDiff
        inline={!this.block}
        original={this.original}
        replacement={replacement}
        {...(replacementMarks === undefined ? {} : { replacementMarks })}
      />
    )
  }
}

class SuggestionActionsWidget extends ReactWidget {
  constructor(
    readonly suggestion: TextSuggestion,
    readonly target: string,
    readonly display: SuggestionDisplay,
    private readonly controller: SuggestionControllerActions,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof SuggestionActionsWidget &&
      other.suggestion.id === this.suggestion.id &&
      other.suggestion.label === this.suggestion.label &&
      other.suggestion.note === this.suggestion.note &&
      other.suggestion.replacement === this.suggestion.replacement &&
      other.target === this.target &&
      other.display === this.display
    )
  }

  protected createDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-suggestion-actions'
    return dom
  }

  protected render(): ReactNode {
    const { id, label, note, replacement } = this.suggestion
    return (
      <SuggestionActionBar
        label={label}
        note={note}
        onAccept={() => {
          this.controller.accept(id)
        }}
        onReject={() => {
          this.controller.reject(id)
        }}
        showsMarkupAsText={/<[a-z/!]|\]\(/iu.test(replacement)}
        target={this.target}
        variant={this.display === 'seam' ? 'seam' : 'band'}
      />
    )
  }
}

class InFlightWidget extends ReactWidget {
  constructor(
    readonly position: InFlightSuggestion,
    private readonly controller: SuggestionControllerActions,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof InFlightWidget &&
      other.position.label === this.position.label &&
      other.position.from === this.position.from &&
      other.position.to === this.position.to
    )
  }

  override updateDOM(dom: HTMLElement, _view: EditorView, from: this): boolean {
    if (from.position.label !== this.position.label) return false
    setRangeData(dom, this.position)
    return true
  }

  protected createDOM(): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-suggestion-widget'
    setRangeData(dom, this.position)
    return dom
  }

  protected render(): ReactNode {
    return (
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
    )
  }
}

class SuggestionOpenerWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly display: SuggestionDisplay,
    private readonly controller: SuggestionControllerActions,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof SuggestionOpenerWidget &&
      other.id === this.id &&
      other.display === this.display
    )
  }

  override toDOM(): HTMLElement {
    const seam = this.display === 'seam'
    const container = document.createElement(seam ? 'div' : 'span')
    if (seam) container.className = 'cm-suggestion-seam'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = seam
      ? 'cm-suggestion-seam-button'
      : 'cm-suggestion-marker'
    button.textContent = seam ? '↕ つなぎの文の修正案' : '提案'
    button.setAttribute(
      'aria-label',
      seam ? 'つなぎの文の修正案を開く' : '提案を開く',
    )
    button.addEventListener('click', () => {
      this.controller.focus(this.id)
    })
    container.append(button)
    return container
  }

  override ignoreEvent(): boolean {
    return true
  }
}
