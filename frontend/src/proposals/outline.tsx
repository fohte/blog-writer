import { isolateHistory } from '@codemirror/commands'
import {
  type ChangeSet,
  type Extension,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { Result } from 'neverthrow'
import { useEffect, useState } from 'react'
import type * as Y from 'yjs'

import { getPremise } from '#article/index'
import { topLevelBlocks } from '#article/move-block-structure'
import type { components } from '#lib/api/schema.gen.d.ts'
import { type LlmSettings, loadLlmSettings } from '#lib/llm-settings'
import { postLlmResult } from '#lib/llm-sse'
import { ArticleOutline } from '#outline/article-outline'
import type { MoveHistory } from '#outline/move-history'

type OutlineProposalRequest = components['schemas']['OutlineProposalRequest']
type OutlineProposalResponse = components['schemas']['OutlineProposalResponse']

export type OutlineSuggestion = {
  id: string
  from: number
  to: number
  replacement: string
  guardFrom?: number
  guardTo?: number
}

export type OutlineProposalState = {
  suggestions: readonly OutlineSuggestion[]
  generating: boolean
}

export type OutlineProposalEditorContext = {
  doc: Y.Doc
  history: MoveHistory
}

export type OutlineProposalAccessoryContext = OutlineProposalEditorContext & {
  view: EditorView | null
  replaceBody: (value: string) => void
}

export interface OutlineProposalOptions {
  debounceMs?: number
  fetcher?: typeof fetch
  getSettings?: () => Result<LlmSettings, Error>
}

type TrackedSuggestion = Pick<
  OutlineSuggestion,
  'from' | 'to' | 'replacement'
> & { guardFrom: number; guardTo: number }
type ManagedSuggestion = OutlineSuggestion & {
  guardFrom: number
  guardTo: number
}
type RejectedSuggestion = TrackedSuggestion

type InternalState = {
  suggestions: ManagedSuggestion[]
  rejected: RejectedSuggestion[]
  generating: boolean
}

const updateSuggestions = StateEffect.define<ManagedSuggestion[]>()
const updateGenerating = StateEffect.define<boolean>()
const acceptSuggestion = StateEffect.define<string>()
const rejectSuggestion = StateEffect.define<string>()
const stateByDocument = new WeakMap<Y.Doc, OutlineProposalController>()

function touchesRange(
  from: number,
  to: number,
  changedFrom: number,
  changedTo: number,
): boolean {
  if (changedFrom === changedTo) {
    return from === to
      ? changedFrom === from
      : changedFrom >= from && changedFrom <= to
  }
  if (from === to) {
    return changedFrom < from && changedTo > from
  }
  return changedFrom < to && changedTo > from
}

function mapRange(
  range: TrackedSuggestion,
  changes: ChangeSet,
): TrackedSuggestion | null {
  const changedRanges: [number, number][] = []
  changes.iterChangedRanges((from, to) => changedRanges.push([from, to]))
  if (
    changedRanges.some(([from, to]) =>
      touchesRange(range.guardFrom, range.guardTo, from, to),
    )
  ) {
    return null
  }
  return {
    ...range,
    from: changes.mapPos(range.from, 1),
    to: changes.mapPos(range.to, -1),
    guardFrom: changes.mapPos(range.guardFrom, 1),
    guardTo: changes.mapPos(range.guardTo, -1),
  }
}

function requestUrl(settings: LlmSettings): string {
  if (settings.route === 'server') return '/api/proposals/outline'
  return `${settings.bridgeUrl.replace(/\/+$/, '')}/api/proposals/outline`
}

function requestBody(doc: Y.Doc, markdown: string): OutlineProposalRequest {
  const premise = getPremise(doc)
  return {
    premise: {
      audience: premise.audience ?? '',
      purpose: premise.purpose ?? '',
      thesis: premise.claim ?? '',
    },
    body_length: markdown.length,
    blocks: topLevelBlocks(markdown).map((block, index) => ({
      id: `article-block-${String(index + 1)}`,
      kind: /^ATXHeading[1-6]$/u.test(block.name)
        ? 'heading'
        : block.name === 'Paragraph'
          ? 'paragraph'
          : block.name.toLowerCase(),
      markdown: markdown.slice(block.from, block.contentTo),
      from: block.from,
      to: block.contentTo,
    })),
  }
}

function isOutlineProposalResponse(
  value: unknown,
): value is OutlineProposalResponse {
  if (typeof value !== 'object' || value === null) return false
  const suggestions = (value as { suggestions?: unknown }).suggestions
  return (
    Array.isArray(suggestions) &&
    suggestions.every(
      (suggestion: unknown) =>
        typeof suggestion === 'object' &&
        suggestion !== null &&
        Number.isInteger((suggestion as { from?: unknown }).from) &&
        Number.isInteger((suggestion as { to?: unknown }).to) &&
        typeof (suggestion as { replacement?: unknown }).replacement ===
          'string',
    )
  )
}

class OutlineProposalController {
  readonly extension: Extension
  private view: EditorView | null = null
  private readonly stateField = StateField.define<InternalState>({
    create: () => ({ suggestions: [], rejected: [], generating: false }),
    update: (current, transaction) => {
      let suggestions = current.suggestions
      let rejected = current.rejected
      let generating = current.generating

      if (transaction.docChanged) {
        suggestions = suggestions.flatMap((suggestion) => {
          const mapped = mapRange(suggestion, transaction.changes)
          return mapped ? [{ ...suggestion, ...mapped }] : []
        })
        rejected = rejected.flatMap((suggestion) => {
          const mapped = mapRange(suggestion, transaction.changes)
          return mapped ? [mapped] : []
        })
      }

      for (const effect of transaction.effects) {
        if (effect.is(updateSuggestions)) suggestions = effect.value
        if (effect.is(updateGenerating)) generating = effect.value
        if (effect.is(acceptSuggestion)) {
          suggestions = suggestions.filter(({ id }) => id !== effect.value)
        }
        if (effect.is(rejectSuggestion)) {
          const rejectedSuggestion = suggestions.find(
            ({ id }) => id === effect.value,
          )
          suggestions = suggestions.filter(({ id }) => id !== effect.value)
          if (rejectedSuggestion) {
            rejected = [
              ...rejected,
              {
                from: rejectedSuggestion.from,
                to: rejectedSuggestion.to,
                replacement: rejectedSuggestion.replacement,
                guardFrom: rejectedSuggestion.guardFrom,
                guardTo: rejectedSuggestion.guardTo,
              },
            ]
          }
        }
      }

      if (
        suggestions === current.suggestions &&
        rejected === current.rejected &&
        generating === current.generating
      ) {
        return current
      }
      return { suggestions, rejected, generating }
    },
  })
  private readonly listeners = new Set<() => void>()
  private readonly trackers = new Set<ChangeSet[]>()
  private lastStartedBody = ''
  private timer: number | undefined
  private activeRequest: AbortController | undefined
  private requestId = 0
  private suggestionId = 0

  constructor(
    private readonly context: OutlineProposalEditorContext,
    private readonly options: OutlineProposalOptions = {},
  ) {
    this.extension = [
      this.stateField,
      ViewPlugin.define((view) => {
        this.mount(view)
        return {
          update: (update: ViewUpdate) => {
            this.update(update)
          },
          destroy: () => {
            this.unmount()
          },
        }
      }),
    ]
    stateByDocument.set(context.doc, this)
  }

  getState(): OutlineProposalState {
    const current = this.view?.state.field(this.stateField, false)
    return current
      ? { suggestions: current.suggestions, generating: current.generating }
      : { suggestions: [], generating: false }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  accept(id: string): void {
    const view = this.view
    const suggestion = view?.state
      .field(this.stateField, false)
      ?.suggestions.find((candidate) => candidate.id === id)
    if (!view || !suggestion) return
    view.dispatch({
      changes: {
        from: suggestion.from,
        to: suggestion.to,
        insert: suggestion.replacement,
      },
      effects: acceptSuggestion.of(id),
      annotations: [
        Transaction.userEvent.of('input.type'),
        isolateHistory.of('full'),
      ],
    })
    view.focus()
  }

  reject(id: string): void {
    if (!this.view) return
    this.view.dispatch({ effects: rejectSuggestion.of(id) })
    this.view.focus()
  }

  private mount(view: EditorView): void {
    this.view = view
    this.lastStartedBody = view.state.doc.toString()
    this.notify()
  }

  private unmount(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer)
    this.activeRequest?.abort()
    this.activeRequest = undefined
    this.trackers.clear()
    this.view = null
    if (stateByDocument.get(this.context.doc) === this) {
      stateByDocument.delete(this.context.doc)
    }
    this.notify()
  }

  private update(update: ViewUpdate): void {
    for (const transaction of update.transactions) {
      if (!transaction.docChanged) continue
      for (const tracker of this.trackers) tracker.push(transaction.changes)
    }
    this.notify()
    if (update.docChanged) this.schedule()
  }

  private schedule(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = undefined
      const markdown = this.view?.state.doc.toString()
      if (markdown === undefined || markdown === this.lastStartedBody) return
      this.lastStartedBody = markdown
      this.startRequest(markdown)
    }, this.options.debounceMs ?? 30_000)
  }

  private startRequest(markdown: string): void {
    this.activeRequest?.abort()
    const abortController = new AbortController()
    this.activeRequest = abortController
    const requestId = ++this.requestId
    const tracker: ChangeSet[] = []
    this.trackers.add(tracker)
    this.dispatchEffect(updateGenerating.of(true))

    const settings = (
      this.options.getSettings ??
      (() => loadLlmSettings(() => window.localStorage))
    )()
    if (settings.isErr()) {
      this.finishRequest(requestId, tracker)
      return
    }

    const body = requestBody(this.context.doc, markdown)
    const result = postLlmResult<
      OutlineProposalRequest,
      OutlineProposalResponse
    >({
      url: requestUrl(settings.value),
      body,
      signal: abortController.signal,
      ...(this.options.fetcher === undefined
        ? {}
        : { fetcher: this.options.fetcher }),
      isResult: isOutlineProposalResponse,
    })
    void result.match(
      (response) => {
        if (requestId === this.requestId) {
          this.setSuggestions(
            response.suggestions,
            tracker,
            markdown.length,
            body,
          )
        }
        this.finishRequest(requestId, tracker)
      },
      () => {
        this.finishRequest(requestId, tracker)
      },
    )
  }

  private setSuggestions(
    response: OutlineProposalResponse['suggestions'],
    tracker: ChangeSet[],
    requestLength: number,
    request: OutlineProposalRequest,
  ): void {
    const view = this.view
    const state = view?.state.field(this.stateField, false)
    if (!state || !view) return
    const candidates = response.flatMap((suggestion, index) => {
      if (
        !Number.isInteger(suggestion.from) ||
        !Number.isInteger(suggestion.to) ||
        suggestion.from < 0 ||
        suggestion.to < suggestion.from ||
        suggestion.to > requestLength
      ) {
        return []
      }
      const targetBlock = request.blocks.find((block) =>
        suggestion.from === suggestion.to
          ? block.kind === 'paragraph' && block.from === suggestion.from
          : block.kind === 'heading' &&
            block.from === suggestion.from &&
            block.to === suggestion.to,
      )
      let mapped: TrackedSuggestion | null = {
        from: suggestion.from,
        to: suggestion.to,
        replacement: suggestion.replacement,
        guardFrom: targetBlock?.from ?? suggestion.from,
        guardTo: targetBlock?.to ?? suggestion.to,
      }
      for (const changes of tracker) {
        if (!mapped) break
        mapped = mapRange(mapped, changes)
      }
      if (
        !mapped ||
        mapped.from < 0 ||
        mapped.to > view.state.doc.length ||
        state.rejected.some(
          (rejected) =>
            rejected.from === mapped.from &&
            rejected.to === mapped.to &&
            rejected.guardFrom === mapped.guardFrom &&
            rejected.guardTo === mapped.guardTo &&
            rejected.replacement === mapped.replacement,
        )
      ) {
        return []
      }
      return [
        {
          id: `outline-${String(this.suggestionId + index)}`,
          ...mapped,
        },
      ]
    })
    this.suggestionId += candidates.length
    this.dispatchEffect(updateSuggestions.of(candidates))
  }

  private finishRequest(requestId: number, tracker: ChangeSet[]): void {
    this.trackers.delete(tracker)
    if (requestId === this.requestId) {
      this.activeRequest = undefined
      this.dispatchEffect(updateGenerating.of(false))
    }
  }

  private dispatchEffect<Value>(effect: StateEffect<Value>): void {
    this.view?.dispatch({ effects: effect })
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

export function createOutlineProposalExtension(
  context: OutlineProposalEditorContext,
  options: OutlineProposalOptions = {},
): Extension {
  return new OutlineProposalController(context, options).extension
}

export function OutlineProposalAccessory({
  doc,
  history,
  view,
}: OutlineProposalAccessoryContext) {
  const controller = stateByDocument.get(doc)
  const [state, setState] = useState<OutlineProposalState>(
    () => controller?.getState() ?? { suggestions: [], generating: false },
  )

  useEffect(() => {
    if (!controller) return
    const update = () => {
      setState(controller.getState())
    }
    update()
    return controller.subscribe(update)
  }, [controller])

  if (!view) return null
  return (
    <ArticleOutline
      doc={doc}
      history={history}
      view={view}
      proposalState={state}
      onProposalAccept={(id) => controller?.accept(id)}
      onProposalReject={(id) => controller?.reject(id)}
    />
  )
}
