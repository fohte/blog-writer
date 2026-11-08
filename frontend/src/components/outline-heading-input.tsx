import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

export type OutlineKeyAction =
  | 'previous'
  | 'next'
  | 'add'
  | 'indent'
  | 'outdent'
  | 'move-up'
  | 'move-down'
  | 'delete'
  | 'exit'
  | 'undo'
  | 'redo'

export type OutlineHeadingEditing = {
  /** Changes whenever focus must return to the input, even on the same row. */
  focusKey: number
  onAction: (action: OutlineKeyAction, draft: string) => void
  onBlur: (draft: string) => void
}

function actionForKey(
  event: KeyboardEvent<HTMLInputElement>,
  dirty: boolean,
): OutlineKeyAction | undefined {
  const mod = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()
  if (mod && key === 'backspace') return 'delete'
  // A dirty draft keeps the input's own undo, so typing can be stepped back before it reaches the body.
  if (mod && !dirty && key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (mod && !dirty && key === 'y') return 'redo'
  if (mod) return undefined
  if (event.key === 'ArrowUp') return event.altKey ? 'move-up' : 'previous'
  if (event.key === 'ArrowDown') return event.altKey ? 'move-down' : 'next'
  if (event.key === 'Enter') return 'add'
  if (event.key === 'Tab') return event.shiftKey ? 'outdent' : 'indent'
  if (event.key === 'Escape') return 'exit'
  return undefined
}

export function OutlineHeadingInput({
  editing: { focusKey, onAction, onBlur },
  text,
}: {
  editing: OutlineHeadingEditing
  text: string
}) {
  const [draft, setDraft] = useState(text)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(text)
  }, [text])

  useLayoutEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusKey])

  return (
    <input
      aria-label="見出しを編集"
      className="min-w-0 flex-1 bg-transparent outline-none"
      onBlur={() => {
        onBlur(draft)
      }}
      onChange={(event) => {
        setDraft(event.target.value)
      }}
      onClick={(event) => {
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        // Enter and arrows confirm or navigate the IME candidates during composition.
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari reports the key that ends a composition with isComposing false, and only keyCode 229 identifies it.
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        const action = actionForKey(event, draft !== text)
        if (action === undefined) return
        event.preventDefault()
        onAction(action, draft)
      }}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      ref={inputRef}
      type="text"
      value={draft}
    />
  )
}
