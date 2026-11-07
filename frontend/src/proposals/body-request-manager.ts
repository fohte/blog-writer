import type * as Y from 'yjs'

import {
  createSuggestionLayer,
  type SuggestionLayerController,
} from '#editor/suggestion-layer'
import { getBlankLineInsertionSeparators } from '#proposals/body-request-context'
import {
  persistAcceptedEvidence,
  type WriteFromKeyPointsMetadata,
} from '#proposals/write-from-key-points'

export function preserveBlankLineSeparators(
  text: string,
  range: { from: number; to: number },
  replacement: string,
): string {
  if (range.from !== range.to || replacement.length === 0) return replacement

  const before = text.slice(0, range.from)
  const after = text.slice(range.to)
  const separators = getBlankLineInsertionSeparators(before, after, replacement)
  return `${separators.before}${replacement}${separators.after}`
}

class BodyRequestManager {
  readonly layer: SuggestionLayerController<WriteFromKeyPointsMetadata>

  private activeRequest: AbortController | null = null
  private readonly listeners = new Set<(preserveInput: boolean) => void>()
  private readonly openListeners = new Set<() => void>()
  private readonly evidenceErrorListeners = new Set<() => void>()

  constructor(private readonly doc: Y.Doc) {
    this.layer = createSuggestionLayer<WriteFromKeyPointsMetadata>({
      trackAcceptedRanges: true,
      onResolve: (suggestion, decision, acceptedRange) => {
        if (decision !== 'accept') {
          acceptedRange?.dispose()
          return
        }
        persistAcceptedEvidence(
          this.doc,
          suggestion.metadata,
          acceptedRange,
        ).match(
          () => undefined,
          () => {
            this.evidenceErrorListeners.forEach((listener) => {
              listener()
            })
          },
        )
      },
      onCancelInFlight: () => {
        this.cancelRequest()
      },
      onInFlightRangeEdited: () => {
        this.cancelRequest(true)
      },
    })
  }

  subscribe(listener: (preserveInput: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeOpen(listener: () => void): () => void {
    this.openListeners.add(listener)
    return () => this.openListeners.delete(listener)
  }

  subscribeEvidenceError(listener: () => void): () => void {
    this.evidenceErrorListeners.add(listener)
    return () => this.evidenceErrorListeners.delete(listener)
  }

  openRequest(): void {
    this.openListeners.forEach((listener) => {
      listener()
    })
  }

  beginRequest(): AbortController {
    this.abortActiveRequest()
    const controller = new AbortController()
    this.activeRequest = controller
    return controller
  }

  finishRequest(controller: AbortController): void {
    if (this.activeRequest === controller) this.activeRequest = null
  }

  clearInFlight(): void {
    this.layer.setInFlight(null).match(
      () => undefined,
      () => undefined,
    )
  }

  clearSuggestions(): void {
    this.layer.setSuggestions([]).match(
      () => undefined,
      () => undefined,
    )
  }

  abortActiveRequest(): void {
    this.activeRequest?.abort()
    this.activeRequest = null
  }

  cancelRequest(preserveInput = false): void {
    this.abortActiveRequest()
    this.listeners.forEach((listener) => {
      listener(preserveInput)
    })
  }
}

const managers = new WeakMap<Y.Doc, BodyRequestManager>()

export function getBodyRequestManager(doc: Y.Doc): BodyRequestManager {
  let manager = managers.get(doc)
  if (!manager) {
    manager = new BodyRequestManager(doc)
    managers.set(doc, manager)
  }
  return manager
}
