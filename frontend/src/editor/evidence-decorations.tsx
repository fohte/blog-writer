import { type EditorState, StateEffect } from '@codemirror/state'
import {
  Decoration,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import * as Y from 'yjs'

import { listEvidence, observeEvidence, pruneEvidence } from '#article/evidence'
import { listSources } from '#article/sources'
import type { EvidenceVerdict } from '#article/types'

const refreshEffect = StateEffect.define()

type EvidenceWidgetOptions = {
  id: string
  verdict: EvidenceVerdict
  edited: boolean
}

class EvidenceWidget extends WidgetType {
  constructor(
    private readonly value: EvidenceWidgetOptions,
    private readonly onOpen: (id: string) => void,
  ) {
    super()
  }

  override eq(other: EvidenceWidget): boolean {
    return JSON.stringify(this.value) === JSON.stringify(other.value)
  }

  override toDOM(): HTMLElement {
    const marker = document.createElement('button')
    marker.type = 'button'
    marker.className = `cm-evidence-marker ${this.value.edited ? 'cm-evidence-edited' : this.value.verdict === 'supported' ? 'cm-evidence-supported' : 'cm-evidence-needs-review'}`
    marker.textContent = '●'
    marker.setAttribute('aria-label', '根拠カードを開く')
    marker.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.onOpen(this.value.id)
    })
    return marker
  }

  override ignoreEvent(): boolean {
    return true
  }
}

export function evidenceDecorations(doc: Y.Doc, onOpen: (id: string) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations
      private readonly unobserve: () => void

      constructor(view: EditorView) {
        pruneEvidence(doc)
        this.decorations = buildDecorations(view.state, doc, onOpen)
        this.unobserve = observeEvidence(doc, () => {
          requestAnimationFrame(() => {
            if (!view.dom.isConnected) return
            pruneEvidence(doc)
            view.dispatch({ effects: refreshEffect.of(null) })
          })
        })
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) pruneEvidence(doc)
        if (
          update.docChanged ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(refreshEffect)),
          )
        ) {
          this.decorations = buildDecorations(update.state, doc, onOpen)
        }
      }

      destroy(): void {
        this.unobserve()
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}

function buildDecorations(
  state: EditorState,
  doc: Y.Doc,
  onOpen: (id: string) => void,
) {
  const items = listEvidence(doc)
  if (items.length === 0) return Decoration.none
  const sources = new Map(listSources(doc).map((source) => [source.id, source]))
  const decorations = []
  for (const item of items) {
    const source = sources.get(item.sourceId)
    if (!source) continue
    const from = Y.createAbsolutePositionFromRelativePosition(item.from, doc)
    const to = Y.createAbsolutePositionFromRelativePosition(item.to, doc)
    if (!from || !to || to.index <= from.index) continue
    const textToDecorate = Math.min(to.index, state.doc.length)
    const textFrom = textToDecorate - 1
    if (textFrom < from.index) continue
    const verdict = item.edited ? 'edited' : item.verdict
    decorations.push(
      Decoration.mark({
        class: `cm-evidence-text cm-evidence-text-${verdict}`,
      }).range(textFrom, textToDecorate),
      Decoration.widget({
        widget: new EvidenceWidget(
          {
            id: item.id,
            verdict: item.verdict,
            edited: item.edited,
          },
          onOpen,
        ),
        side: 1,
      }).range(to.index),
    )
  }
  return Decoration.set(decorations, true)
}
