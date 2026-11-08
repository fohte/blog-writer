import { defaultKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

import { getBody } from '#article/body'
import {
  listEvidence,
  observeEvidence,
  removeEvidence,
} from '#article/evidence'
import { listSources } from '#article/sources'
import { ClaimEvidenceCard } from '#components/claim-evidence-card'
import { evidenceDecorations } from '#editor/evidence-decorations'
import { evidenceDrop } from '#editor/evidence-drop'
import { markdownDecorations } from '#editor/markdown-decorations'
import { replaceBody } from '#editor/replace-body'
import { editorTheme, markdownHighlightStyle } from '#editor/theme'
import type { MoveHistory } from '#outline/move-history'

export interface MarkdownEditorHandle {
  replaceBody(value: string): void
}

export interface MarkdownEditorProps {
  text: Y.Text
  extensions?: Extension[]
  initialSelection?: { anchor: number; head?: number }
  ariaLabel?: string
  className?: string
  articleId?: string
  onEvidenceError?: (message: string) => void
  history: MoveHistory
  onViewChange?: (view: EditorView | null) => void
}

const noExtensions: Extension[] = []

function runHistoryStep(history: MoveHistory, step: 'undo' | 'redo') {
  return (view: EditorView) =>
    history[step](view).match(
      () => true,
      () => true,
    )
}

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    text,
    extensions = noExtensions,
    initialSelection,
    ariaLabel = 'Article body',
    className,
    articleId,
    onEvidenceError,
    history,
    onViewChange,
  },
  ref,
) {
  const [evidenceError, setEvidenceError] = useState<string>()
  const [activeEvidenceId, setActiveEvidenceId] = useState<string>()
  const [evidenceVersion, setEvidenceVersion] = useState(0)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const extensionsCompartment = useRef(new Compartment()).current
  const evidenceExtensionsCompartment = useRef(new Compartment()).current
  const initialSelectionAtMount = useRef(initialSelection).current
  const onEvidenceErrorRef = useRef(onEvidenceError)
  onEvidenceErrorRef.current = onEvidenceError
  const onViewChangeRef = useRef(onViewChange)
  const openEvidence = useCallback((id: string) => {
    setActiveEvidenceId((current) => (current === id ? undefined : id))
  }, [])
  const reportEvidenceError = useCallback((message: string) => {
    setEvidenceError(message)
    onEvidenceErrorRef.current?.(message)
  }, [])
  const clearEvidenceError = useCallback(() => {
    setEvidenceError(undefined)
  }, [])
  const evidenceExtensions = useMemo(
    () => [
      ...(text.doc !== null
        ? [evidenceDecorations(text.doc, openEvidence)]
        : []),
      ...(text.doc && articleId !== undefined && articleId.length > 0
        ? [
            evidenceDrop(
              text.doc,
              articleId,
              reportEvidenceError,
              clearEvidenceError,
            ),
          ]
        : []),
    ],
    [articleId, clearEvidenceError, openEvidence, reportEvidenceError, text],
  )
  const initialEvidenceExtensions = useRef(evidenceExtensions).current
  const initialCustomExtensions = useRef(extensions).current
  const appliedEvidenceExtensions = useRef(initialEvidenceExtensions)
  const appliedCustomExtensions = useRef(initialCustomExtensions)

  useEffect(() => {
    onViewChangeRef.current = onViewChange
  }, [onViewChange])

  useImperativeHandle(
    ref,
    () => ({
      replaceBody(value) {
        const view = viewRef.current
        if (view) replaceBody(view, value)
      },
    }),
    [],
  )

  useEffect(() => {
    if (activeEvidenceId === undefined) return
    const closeEvidence = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveEvidenceId(undefined)
    }
    window.addEventListener('keydown', closeEvidence)
    return () => {
      window.removeEventListener('keydown', closeEvidence)
    }
  }, [activeEvidenceId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text.toJSON(),
        ...(initialSelectionAtMount
          ? { selection: initialSelectionAtMount }
          : {}),
        extensions: [
          markdown({ extensions: GFM, codeLanguages: languages }),
          syntaxHighlighting(markdownHighlightStyle),
          markdownDecorations,
          editorTheme,
          EditorView.lineWrapping,
          history.extension,
          keymap.of([
            {
              key: 'Mod-z',
              run: runHistoryStep(history, 'undo'),
            },
            {
              key: 'Mod-Shift-z',
              run: runHistoryStep(history, 'redo'),
            },
            {
              key: 'Mod-y',
              run: runHistoryStep(history, 'redo'),
            },
            ...defaultKeymap,
          ]),
          EditorView.contentAttributes.of({
            'aria-label': ariaLabel,
            'aria-multiline': 'true',
            role: 'textbox',
            spellcheck: 'false',
          }),
          yCollab(text, null, { undoManager: false }),
          evidenceExtensionsCompartment.of(initialEvidenceExtensions),
          extensionsCompartment.of(initialCustomExtensions),
        ],
      }),
    })

    viewRef.current = view
    onViewChangeRef.current?.(view)

    return () => {
      view.destroy()
      onViewChangeRef.current?.(null)
      viewRef.current = null
    }
  }, [
    ariaLabel,
    evidenceExtensionsCompartment,
    extensionsCompartment,
    history,
    initialCustomExtensions,
    initialEvidenceExtensions,
    text,
  ])

  useEffect(() => {
    if (appliedEvidenceExtensions.current === evidenceExtensions) return
    appliedEvidenceExtensions.current = evidenceExtensions
    const view = viewRef.current
    if (view) {
      view.dispatch({
        effects: evidenceExtensionsCompartment.reconfigure(evidenceExtensions),
      })
    }
  }, [evidenceExtensions, evidenceExtensionsCompartment])

  useEffect(() => {
    if (appliedCustomExtensions.current === extensions) return
    appliedCustomExtensions.current = extensions
    const view = viewRef.current
    if (view) {
      view.dispatch({ effects: extensionsCompartment.reconfigure(extensions) })
    }
  }, [extensions, extensionsCompartment])

  useEffect(() => {
    const doc = text.doc
    if (!doc) return
    let observing = true
    const refresh = () => {
      if (!observing || activeEvidenceId === undefined) return
      requestAnimationFrame(() => {
        if (observing) setEvidenceVersion((version) => version + 1)
      })
    }
    const unobserve = observeEvidence(doc, refresh)
    const body = getBody(doc)
    body.observe(refresh)
    return () => {
      observing = false
      unobserve()
      body.unobserve(refresh)
    }
  }, [activeEvidenceId, text])

  const activeEvidence = useMemo(() => {
    if (!text.doc || activeEvidenceId === undefined) return undefined
    const evidence = listEvidence(text.doc).find(
      (item) => item.id === activeEvidenceId,
    )
    if (!evidence) return undefined
    const source =
      evidence.sourceId === null
        ? null
        : listSources(text.doc).find((item) => item.id === evidence.sourceId)
    if (evidence.sourceId !== null && !source) return undefined
    return { evidence, source: source ?? null }
  }, [activeEvidenceId, evidenceVersion, text])

  return (
    <>
      <div className="relative h-full">
        <div
          className={
            className !== undefined && className.length > 0
              ? className
              : 'h-full'
          }
          ref={hostRef}
        />
        {activeEvidence ? (
          <div className="absolute right-4 top-4 z-20">
            <ClaimEvidenceCard
              source={activeEvidence.source}
              quote={activeEvidence.evidence.quote}
              verdict={activeEvidence.evidence.verdict}
              checkedAt={activeEvidence.evidence.checkedAt}
              edited={activeEvidence.evidence.edited}
              onRemove={() => {
                if (!text.doc) return
                removeEvidence(text.doc, activeEvidence.evidence.id)
                setActiveEvidenceId(undefined)
              }}
            />
          </div>
        ) : null}
      </div>
      {evidenceError !== undefined ? (
        <p className="text-sm text-destructive" role="alert">
          {evidenceError}
        </p>
      ) : null}
    </>
  )
})
