import { defaultKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

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
    history,
    onViewChange,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const extensionsCompartment = useRef(new Compartment()).current
  const initialSelectionAtMount = useRef(initialSelection).current
  const onViewChangeRef = useRef(onViewChange)

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
          extensionsCompartment.of(extensions),
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
  }, [ariaLabel, extensionsCompartment, history, text])

  useEffect(() => {
    const view = viewRef.current
    if (view) {
      view.dispatch({ effects: extensionsCompartment.reconfigure(extensions) })
    }
  }, [extensions, extensionsCompartment])

  return <div className={className} ref={hostRef} />
})
