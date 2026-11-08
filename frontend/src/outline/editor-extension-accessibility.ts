import { EditorView, ViewPlugin } from '@codemirror/view'

import { blockStarts } from '#outline/block-ranges'

function isBlockDragHandle(
  target: EventTarget | null,
): target is HTMLButtonElement {
  return (
    target instanceof HTMLButtonElement &&
    target.matches('.cm-block-drag-handle')
  )
}

export function createAccessibleBlockHandleGutter() {
  return ViewPlugin.fromClass(
    class {
      private focusedBlockFrom: string | null = null
      private restoreFocusFrom: string | null = null
      private pendingTabFocusFrom: string | null = null
      private focusRestoreFrame: number | null = null
      private gutterUpdateFrame: number | null = null
      private focusSettleFrame: number | null = null
      private readonly gutterObserver: MutationObserver
      private observedGutter: HTMLElement | null = null
      private pointerFocusChange = false
      private tabScrollPositions: {
        element: HTMLElement
        left: number
        top: number
      }[] = []

      constructor(readonly view: EditorView) {
        this.gutterObserver = new MutationObserver(() => {
          this.observeGutter()
          this.updateGutterAccessibility()
          this.scheduleFocusRestoration()
        })
        this.observeGutter()
        view.dom.addEventListener('focusin', this.onFocusIn)
        view.dom.addEventListener('focusout', this.onFocusOut)
        view.dom.addEventListener('keydown', this.onKeyDown, true)
        view.dom.ownerDocument.addEventListener(
          'keydown',
          this.onDocumentKeyDown,
          true,
        )
        view.dom.ownerDocument.addEventListener(
          'pointerdown',
          this.onDocumentPointerDown,
          true,
        )
        this.updateGutterAccessibility()
      }

      update() {
        if (this.gutterUpdateFrame !== null)
          cancelAnimationFrame(this.gutterUpdateFrame)
        this.gutterUpdateFrame = requestAnimationFrame(() => {
          this.gutterUpdateFrame = null
          this.observeGutter()
          this.updateGutterAccessibility()
          this.scheduleFocusRestoration()
        })
      }

      destroy() {
        this.gutterObserver.disconnect()
        this.view.dom.removeEventListener('focusin', this.onFocusIn)
        this.view.dom.removeEventListener('focusout', this.onFocusOut)
        this.view.dom.removeEventListener('keydown', this.onKeyDown, true)
        this.view.dom.ownerDocument.removeEventListener(
          'keydown',
          this.onDocumentKeyDown,
          true,
        )
        this.view.dom.ownerDocument.removeEventListener(
          'pointerdown',
          this.onDocumentPointerDown,
          true,
        )
        if (this.focusRestoreFrame !== null)
          cancelAnimationFrame(this.focusRestoreFrame)
        if (this.gutterUpdateFrame !== null)
          cancelAnimationFrame(this.gutterUpdateFrame)
        if (this.focusSettleFrame !== null)
          cancelAnimationFrame(this.focusSettleFrame)
      }

      private readonly onFocusIn = (event: FocusEvent) => {
        const target = event.target
        if (isBlockDragHandle(target)) {
          const from = target.dataset['blockFrom'] ?? null
          if (this.pointerFocusChange) {
            this.pointerFocusChange = false
            this.focusedBlockFrom = from
            this.restoreFocusFrom = null
            this.pendingTabFocusFrom = null
            this.updateGutterAccessibility()
            return
          }
          const expectedFrom = this.restoreFocusFrom ?? this.pendingTabFocusFrom
          if (expectedFrom !== null && expectedFrom !== from) {
            this.restoreFocusFrom = expectedFrom
            this.restoreTabScrollPosition()
            this.scheduleFocusRestoration()
            this.updateGutterAccessibility()
            return
          }
          const wasTabFocus = this.pendingTabFocusFrom === from
          this.focusedBlockFrom = from
          this.restoreFocusFrom = null
          this.pendingTabFocusFrom = null
          if (wasTabFocus) this.scheduleTabScrollClear(from)
          this.updateGutterAccessibility()
        } else if (
          target instanceof Node &&
          this.view.contentDOM.contains(target)
        ) {
          this.clearFocusRestoration()
          this.captureTabScrollPositions()
          this.pendingTabFocusFrom =
            this.getCaretHandle()?.dataset['blockFrom'] ?? null
        } else {
          this.clearFocusRestoration()
        }
      }

      private readonly onFocusOut = (event: FocusEvent) => {
        if (
          event.target instanceof Node &&
          this.view.contentDOM.contains(event.target)
        ) {
          if (isBlockDragHandle(event.relatedTarget)) return
          if (
            event.relatedTarget === null ||
            event.relatedTarget === this.view.dom.ownerDocument.body
          ) {
            this.restoreFocusFrom = this.pendingTabFocusFrom
            this.restoreTabScrollPosition()
            this.scheduleFocusRestoration()
          } else {
            this.pendingTabFocusFrom = null
          }
          return
        }
        if (!isBlockDragHandle(event.target)) return
        if (isBlockDragHandle(event.relatedTarget)) {
          const nextFrom = event.relatedTarget.dataset['blockFrom'] ?? null
          if (
            !this.pointerFocusChange &&
            this.restoreFocusFrom !== nextFrom &&
            this.focusedBlockFrom !== nextFrom
          ) {
            this.restoreFocusFrom = this.focusedBlockFrom
            this.scheduleFocusRestoration()
          }
          return
        }
        if (
          event.relatedTarget === null ||
          event.relatedTarget === this.view.dom.ownerDocument.body
        ) {
          this.restoreFocusFrom = this.focusedBlockFrom
          this.restoreTabScrollPosition()
          this.scheduleFocusRestoration()
          return
        }
        this.clearFocusRestoration()
      }

      private readonly onDocumentPointerDown = (event: PointerEvent) => {
        if (!(event.target instanceof Node)) return
        if (!this.view.dom.contains(event.target)) {
          this.clearFocusRestoration()
        } else if (isBlockDragHandle(event.target)) {
          this.pointerFocusChange =
            this.view.dom.ownerDocument.activeElement !== event.target
          this.tabScrollPositions = []
        } else {
          this.clearFocusRestoration()
        }
      }

      private readonly onDocumentKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Tab' || event.shiftKey) return
        if (
          this.view.dom.ownerDocument.activeElement !== this.view.contentDOM
        ) {
          return
        }
        const from =
          this.pendingTabFocusFrom ??
          this.getCaretHandle()?.dataset['blockFrom']
        if (from === undefined) return
        const tabStop = this.getBlockHandles().find(
          (handle) => handle.dataset['blockFrom'] === from,
        )
        if (!tabStop) return
        event.preventDefault()
        this.focusedBlockFrom = from
        this.restoreFocusFrom = from
        tabStop.focus({ preventScroll: true })
      }

      private readonly onKeyDown = (event: KeyboardEvent) => {
        const target = event.target
        if (
          event.key === 'Tab' &&
          event.shiftKey &&
          target instanceof Node &&
          this.view.contentDOM.contains(target)
        ) {
          this.clearFocusRestoration()
          return
        }
        if (
          target instanceof Node &&
          this.view.contentDOM.contains(target) &&
          event.key !== 'Tab'
        ) {
          this.pendingTabFocusFrom = null
        }
        if (!isBlockDragHandle(target)) return
        if (event.key === 'Tab') {
          this.clearFocusRestoration()
          return
        }
        if (event.altKey) return
        const direction =
          event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
        if (direction === 0) return
        const starts = blockStarts(this.view.state)
        const current = Number(target.dataset['blockFrom'])
        const currentIndex = starts.indexOf(current)
        if (currentIndex < 0) return
        const nextFrom = starts[currentIndex + direction]
        if (nextFrom === undefined) return
        event.preventDefault()
        this.focusedBlockFrom = String(nextFrom)
        this.restoreFocusFrom = String(nextFrom)
        this.tabScrollPositions = []
        this.view.dispatch({
          effects: EditorView.scrollIntoView(nextFrom, { y: 'nearest' }),
        })
        this.scheduleFocusRestoration()
      }

      private clearFocusRestoration() {
        this.focusedBlockFrom = null
        this.restoreFocusFrom = null
        this.pendingTabFocusFrom = null
        this.tabScrollPositions = []
        this.pointerFocusChange = false
        if (this.focusRestoreFrame !== null) {
          cancelAnimationFrame(this.focusRestoreFrame)
          this.focusRestoreFrame = null
        }
        if (this.focusSettleFrame !== null) {
          cancelAnimationFrame(this.focusSettleFrame)
          this.focusSettleFrame = null
        }
      }

      private observeGutter() {
        const gutter = this.view.dom.querySelector('.cm-block-move-gutter')
        const parent = gutter?.parentElement ?? null
        if (parent === this.observedGutter) return
        this.gutterObserver.disconnect()
        this.observedGutter = parent
        if (parent) {
          this.gutterObserver.observe(parent, {
            childList: true,
            subtree: true,
          })
        }
      }

      private captureTabScrollPositions() {
        const positions: typeof this.tabScrollPositions = []
        for (
          let element = this.view.dom.parentElement;
          element !== null;
          element = element.parentElement
        ) {
          if (element.scrollHeight <= element.clientHeight) continue
          positions.push({
            element,
            left: element.scrollLeft,
            top: element.scrollTop,
          })
        }
        this.tabScrollPositions = positions
      }

      private restoreTabScrollPosition() {
        for (const position of this.tabScrollPositions) {
          position.element.scrollLeft = position.left
          position.element.scrollTop = position.top
        }
      }

      private scheduleTabScrollClear(from: string | null) {
        if (this.focusSettleFrame !== null)
          cancelAnimationFrame(this.focusSettleFrame)
        this.focusSettleFrame = requestAnimationFrame(() => {
          this.focusSettleFrame = null
          if (
            this.focusedBlockFrom === from &&
            this.restoreFocusFrom === null
          ) {
            this.tabScrollPositions = []
          }
        })
      }

      private getBlockHandles() {
        return [
          ...this.view.dom.querySelectorAll<HTMLButtonElement>(
            '.cm-block-drag-handle',
          ),
        ]
      }

      private getCaretHandle() {
        const handles = this.getBlockHandles()
        return (
          handles
            .filter(
              (handle) =>
                Number(handle.dataset['blockFrom']) <=
                this.view.state.selection.main.head,
            )
            .at(-1) ?? handles[0]
        )
      }

      private scheduleFocusRestoration() {
        const from = this.restoreFocusFrom
        if (from === null) return
        if (this.focusRestoreFrame !== null)
          cancelAnimationFrame(this.focusRestoreFrame)
        this.focusRestoreFrame = requestAnimationFrame(() => {
          this.focusRestoreFrame = null
          if (this.restoreFocusFrom !== from) return

          const doc = this.view.dom.ownerDocument
          const activeElement = doc.activeElement
          if (activeElement !== doc.body && !isBlockDragHandle(activeElement)) {
            this.clearFocusRestoration()
            return
          }

          const handle = [
            ...this.view.dom.querySelectorAll<HTMLButtonElement>(
              '.cm-block-drag-handle',
            ),
          ].find((candidate) => candidate.dataset['blockFrom'] === from)
          if (!handle) return
          this.restoreFocusFrom = null
          handle.focus({ preventScroll: true })
        })
      }

      private updateGutterAccessibility() {
        const blockGutter = this.view.dom.querySelector('.cm-block-move-gutter')
        const gutters = blockGutter?.parentElement
        if (!blockGutter || !gutters) return

        // CodeMirror hides all gutters from assistive technology by default.
        gutters.removeAttribute('aria-hidden')
        for (const child of gutters.children) {
          if (!(child instanceof HTMLElement)) continue
          if (child === blockGutter) {
            child.setAttribute('role', 'group')
            child.setAttribute('aria-label', 'Block move handles')
            child.removeAttribute('aria-hidden')
          } else {
            child.setAttribute('aria-hidden', 'true')
          }
        }

        const handles = this.getBlockHandles()
        const activeHandle = handles.find(
          (handle) => handle === this.view.dom.ownerDocument.activeElement,
        )
        const restoreHandle = handles.find(
          (handle) =>
            handle.dataset['blockFrom'] ===
            (this.restoreFocusFrom ??
              this.pendingTabFocusFrom ??
              this.focusedBlockFrom),
        )
        const caretHandle = this.getCaretHandle()
        const tabStop = activeHandle ?? restoreHandle ?? caretHandle
        for (const handle of handles)
          handle.tabIndex = handle === tabStop ? 0 : -1
      }
    },
  )
}
