import { type Extension, RangeSet } from '@codemirror/state'
import { EditorView, gutter, GutterMarker } from '@codemirror/view'

class RequestMarker extends GutterMarker {
  override toDOM(): Node {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-body-request-marker'
    button.textContent = '>'
    button.title = '依頼を入力'
    // CodeMirror hides gutters from assistive technology, so the editor's shortcut is the way in without a pointer.
    button.tabIndex = -1
    return button
  }
}

const requestMarker = new RequestMarker()

const requestGutterTheme = EditorView.theme({
  // The negative margin lays the gutter over the content's start padding so the text stays where it is.
  '.cm-gutters.cm-gutters-before': {
    backgroundColor: 'transparent',
    borderRightWidth: '0',
    marginInlineEnd: '-1.5rem',
    // Clicks beside the marker still reach the content underneath.
    pointerEvents: 'none',
  },
  '.cm-body-request-gutter': { width: '1.5rem' },
  '.cm-body-request-marker': {
    background: 'transparent',
    border: '0',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
    display: 'block',
    font: 'inherit',
    fontFamily: 'var(--font-mono)',
    marginLeft: '0.5rem',
    padding: '0',
    pointerEvents: 'auto',
    width: '1rem',
  },
  '.cm-body-request-marker:hover': { color: 'var(--primary)' },
  // Touch devices and narrow screens open the request from their own button.
  '@media (pointer: coarse), (max-width: 767px)': {
    '.cm-body-request-marker': { display: 'none' },
  },
})

export function bodyRequestGutter(openRequest: () => void): Extension {
  return [
    gutter({
      class: 'cm-body-request-gutter',
      markers: (view) =>
        RangeSet.of(
          requestMarker.range(
            view.lineBlockAt(view.state.selection.main.head).from,
          ),
        ),
      domEventHandlers: {
        // Keeps focus in the editor so the selection the request targets stays visible.
        mousedown: () => true,
        click: () => {
          openRequest()
          return true
        },
      },
    }),
    requestGutterTheme,
  ]
}
