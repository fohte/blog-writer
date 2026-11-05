import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

export const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: 'var(--muted-foreground)' },
  {
    tag: tags.heading,
    color: 'var(--foreground)',
    fontWeight: '700',
  },
  { tag: tags.link, color: 'var(--primary)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--muted-foreground-faint)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword],
    color: 'var(--tint-magenta-foreground)',
  },
  { tag: [tags.string, tags.docString], color: 'var(--tint-green-foreground)' },
  {
    tag: [tags.number, tags.bool, tags.null],
    color: 'var(--tint-orange-foreground)',
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: 'var(--tint-cyan-foreground)',
  },
  {
    tag: [tags.variableName, tags.propertyName],
    color: 'var(--tint-blue-foreground)',
  },
  {
    tag: [tags.operator, tags.punctuation],
    color: 'var(--muted-foreground-strong)',
  },
  { tag: tags.comment, color: 'var(--muted-foreground-faint)' },
  { tag: tags.invalid, color: 'var(--destructive)' },
])

export const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    fontFamily: 'var(--font-sans)',
    fontSize: '1rem',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.7',
    overflow: 'auto',
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
    padding: '1rem 1.25rem 4rem',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--primary) 22%, transparent)',
  },
  '.cm-md-heading-1': { fontSize: '2rem', fontWeight: '700' },
  '.cm-md-heading-2': { fontSize: '1.65rem', fontWeight: '700' },
  '.cm-md-heading-3': { fontSize: '1.35rem', fontWeight: '650' },
  '.cm-md-heading-4': { fontSize: '1.15rem', fontWeight: '650' },
  '.cm-md-heading-5': { fontSize: '1.05rem', fontWeight: '600' },
  '.cm-md-heading-6': { fontSize: '1rem', fontWeight: '600' },
  '.cm-md-hidden-markup': { display: 'none' },
  '.cm-md-inline-code': {
    backgroundColor: 'color-mix(in srgb, var(--muted) 75%, transparent)',
    borderRadius: '0.25rem',
    color: 'var(--foreground)',
    fontFamily: 'var(--font-code)',
    fontSize: '0.9em',
  },
  '.cm-md-code-text': {
    backgroundColor: 'color-mix(in srgb, var(--muted) 35%, transparent)',
    color: 'var(--primary)',
    fontFamily: 'var(--font-code)',
  },
})
