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
import {
  blockWidgetExclusionProviders,
  refreshBlockWidgetExclusions,
} from '#editor/markdown-block-widget-exclusions'

const refreshEffect = StateEffect.define()

type EvidenceWidgetOptions = {
  id: string
  verdict: EvidenceVerdict
  edited: boolean
  label: string
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
    marker.textContent = `[${this.value.label}]`
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
  return [
    ViewPlugin.fromClass(
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
              view.dispatch({
                effects: [
                  refreshEffect.of(null),
                  refreshBlockWidgetExclusions.of(null),
                ],
              })
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
    ),
    blockWidgetExclusionProviders.of((state) => {
      const sourceIds = new Set(listSources(doc).map((source) => source.id))
      return listEvidence(doc).flatMap((item) => {
        if (item.sourceId !== null && !sourceIds.has(item.sourceId)) return []
        const from = Y.createAbsolutePositionFromRelativePosition(
          item.from,
          doc,
        )
        const to = Y.createAbsolutePositionFromRelativePosition(item.to, doc)
        if (!from || !to || to.index <= from.index) return []
        const end = Math.min(to.index, state.doc.length)
        return end > from.index ? [{ from: from.index, to: end }] : []
      })
    }),
  ]
}

function buildDecorations(
  state: EditorState,
  doc: Y.Doc,
  onOpen: (id: string) => void,
) {
  const items = listEvidence(doc)
  if (items.length === 0) return Decoration.none
  const sourceIds = new Set(listSources(doc).map((source) => source.id))
  const placed = []
  for (const item of items) {
    if (item.sourceId !== null && !sourceIds.has(item.sourceId)) continue
    const from = Y.createAbsolutePositionFromRelativePosition(item.from, doc)
    const to = Y.createAbsolutePositionFromRelativePosition(item.to, doc)
    if (!from || !to || to.index <= from.index) continue
    const end = Math.min(to.index, state.doc.length)
    if (end <= from.index) continue
    placed.push({ item, from: from.index, to: end })
  }
  placed.sort((a, b) => a.to - b.to)
  // Footnotes are numbered per source in reading order; sentences that need review show "?" and take no number.
  const footnotes = new Map<string, number>()
  const decorations = []
  for (const { item, from, to } of placed) {
    const needsReview = item.edited || item.verdict !== 'supported'
    let label = '?'
    if (!needsReview && item.sourceId !== null) {
      const footnote = footnotes.get(item.sourceId) ?? footnotes.size + 1
      footnotes.set(item.sourceId, footnote)
      label = footnote.toString()
    }
    if (needsReview) {
      decorations.push(
        Decoration.mark({
          class: 'cm-evidence-text cm-evidence-text-needs-review',
        }).range(from, to),
      )
    }
    decorations.push(
      Decoration.widget({
        widget: new EvidenceWidget(
          {
            id: item.id,
            verdict: item.verdict,
            edited: item.edited,
            label,
          },
          onOpen,
        ),
        side: 1,
      }).range(to),
    )
  }
  return Decoration.set(decorations, true)
}
