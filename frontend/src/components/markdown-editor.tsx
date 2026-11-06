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
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
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
}

const noExtensions: Extension[] = []

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
  },
  ref,
) {
  const [evidenceError, setEvidenceError] = useState<string>()
  const [activeEvidenceId, setActiveEvidenceId] = useState<string>()
  const [evidenceVersion, setEvidenceVersion] = useState(0)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const undoManagerRef = useRef<Y.UndoManager | null>(null)
  const extensionsCompartment = useRef(new Compartment()).current
  const initialSelectionAtMount = useRef(initialSelection).current
  const openEvidence = useCallback((id: string) => {
    setActiveEvidenceId(id)
  }, [])
  const editorExtensions = useMemo(
    () => [
      ...(text.doc !== null
        ? [evidenceDecorations(text.doc, openEvidence)]
        : []),
      ...(text.doc && articleId !== undefined && articleId.length > 0
        ? [
            evidenceDrop(
              text.doc,
              articleId,
              (message) => {
                setEvidenceError(message)
                onEvidenceError?.(message)
              },
              () => {
                setEvidenceError(undefined)
              },
            ),
          ]
        : []),
      ...extensions,
    ],
    [articleId, extensions, onEvidenceError, openEvidence, text],
  )
  const initialEditorExtensions = useRef(editorExtensions).current

  useImperativeHandle(
    ref,
    () => ({
      replaceBody(value) {
        const view = viewRef.current
        const undoManager = undoManagerRef.current
        if (view && undoManager) replaceBody(view, undoManager, value)
      },
    }),
    [],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const undoManager = new Y.UndoManager(text)
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
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
          EditorView.contentAttributes.of({
            'aria-label': ariaLabel,
            'aria-multiline': 'true',
            role: 'textbox',
            spellcheck: 'false',
          }),
          yCollab(text, null, { undoManager }),
          extensionsCompartment.of(initialEditorExtensions),
        ],
      }),
    })

    viewRef.current = view
    undoManagerRef.current = undoManager

    return () => {
      view.destroy()
      undoManager.destroy()
      viewRef.current = null
      undoManagerRef.current = null
    }
  }, [ariaLabel, extensionsCompartment, initialEditorExtensions, text])

  useEffect(() => {
    const view = viewRef.current
    if (view) {
      view.dispatch({
        effects: extensionsCompartment.reconfigure(editorExtensions),
      })
    }
  }, [editorExtensions, extensionsCompartment])

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
    const source = listSources(text.doc).find(
      (item) => item.id === evidence.sourceId,
    )
    return source ? { evidence, source } : undefined
  }, [activeEvidenceId, evidenceVersion, text])

  return (
    <>
      <div className="relative h-full">
        <div
          className={
            className !== undefined && className.length > 0
              ? `h-full ${className}`
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
              publishedAt={null}
              edited={activeEvidence.evidence.edited}
              onRemove={() => {
                if (!text.doc) return
                removeEvidence(text.doc, activeEvidence.evidence.id)
                setActiveEvidenceId(undefined)
              }}
              showMarker={false}
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
