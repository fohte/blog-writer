import { defaultKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import * as Y from 'yjs'

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
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const undoManagerRef = useRef<Y.UndoManager | null>(null)
  const extensionsCompartment = useRef(new Compartment()).current
  const initialSelectionRef = useRef(initialSelection).current

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
        selection: initialSelectionRef ?? { anchor: 0 },
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
          extensionsCompartment.of(extensions),
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
  }, [ariaLabel, extensionsCompartment, text])

  useEffect(() => {
    const view = viewRef.current
    if (view) {
      view.dispatch({ effects: extensionsCompartment.reconfigure(extensions) })
    }
  }, [extensions, extensionsCompartment])

  return <div className={className} ref={hostRef} />
})
