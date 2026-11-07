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
    lineHeight: '1.95',
    overflow: 'auto',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--background)',
    color: 'var(--muted-foreground)',
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
  '.cm-md-heading': { fontWeight: '700', lineHeight: '1.5' },
  '.cm-md-heading-1': { fontSize: '1.75rem' },
  '.cm-md-heading-2': { fontSize: '1.25rem' },
  '.cm-md-heading-3': { fontSize: '1.0625rem' },
  '.cm-md-header-mark, .cm-md-header-mark *': {
    color: 'var(--primary)',
    fontFamily: 'var(--font-mono)',
    fontWeight: '400',
  },
  '.cm-md-hidden-markup': { display: 'none' },
  '.cm-md-inline-code': {
    backgroundColor: 'var(--accent)',
    borderRadius: '0.25rem',
    color: 'var(--foreground)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.875em',
    padding: '1px 4px',
  },
  '.cm-md-code-mark, .cm-md-code-mark *': { color: 'var(--muted-foreground)' },
  '.cm-md-code-text': {
    backgroundColor: 'color-mix(in srgb, var(--muted) 35%, transparent)',
    color: 'var(--primary)',
    fontFamily: 'var(--font-code)',
  },
  '.cm-evidence-text-supported': {
    textDecoration: 'underline dotted var(--tint-green-foreground)',
  },
  '.cm-evidence-text-insufficient, .cm-evidence-text-outdated, .cm-evidence-text-contradicted, .cm-evidence-text-edited':
    {
      textDecoration: 'underline dotted var(--tint-yellow-foreground)',
    },
  '.cm-evidence-marker': {
    border: '0',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '0.72rem',
    padding: '0 0.1rem',
  },
  '.cm-evidence-supported': { color: 'var(--tint-green-foreground)' },
  '.cm-evidence-needs-review, .cm-evidence-edited': {
    color: 'var(--tint-yellow-foreground)',
  },
})

export const editorDarkMode = EditorView.theme({}, { dark: true })
