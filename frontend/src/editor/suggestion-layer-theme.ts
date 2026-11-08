import { EditorView } from '@codemirror/view'

export const suggestionLayerTheme = EditorView.baseTheme({
  '.cm-suggestion-widget': {
    whiteSpace: 'normal',
  },
  '.cm-suggestion-in-flight-target': {
    textDecoration: 'underline dotted var(--muted-foreground)',
    textUnderlineOffset: '5px',
  },
  '.cm-suggestion-target': {
    textDecoration: 'underline dotted var(--tint-green-foreground)',
    textUnderlineOffset: '5px',
  },
  '.cm-suggestion-focused-line, .cm-suggestion-block': {
    outline: '1px solid var(--border)',
    outlineOffset: '8px',
  },
  '.cm-suggestion-marker-line': {
    position: 'relative',
  },
  // Keep the marker outside the text line so it does not cover line content.
  '.cm-suggestion-marker': {
    position: 'absolute',
    right: 'calc(100% + 0.25rem)',
    top: '50%',
    transform: 'translateY(-50%)',
    border: '1px solid var(--tint-green-foreground)',
    background: 'transparent',
    color: 'var(--tint-green-foreground)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    lineHeight: '18px',
    padding: '0 4px',
    whiteSpace: 'nowrap',
  },
  '.cm-suggestion-seam': {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '4px 0',
  },
  '.cm-suggestion-seam::before, .cm-suggestion-seam::after': {
    content: '""',
    flex: '1',
    borderTop: '1px dashed var(--border)',
  },
  '.cm-suggestion-seam-button': {
    border: '1px dashed var(--tint-green-foreground)',
    background: 'transparent',
    color: 'var(--tint-green-foreground)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    lineHeight: '1.6',
    padding: '2px 10px',
  },
})
