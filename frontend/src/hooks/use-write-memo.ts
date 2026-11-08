import { useCallback, useEffect } from 'react'
import { flushSync } from 'react-dom'

export function useWriteMemo(setPanel: (panel: 'memo') => void): () => void {
  const writeMemo = useCallback(() => {
    flushSync(() => {
      setPanel('memo')
    })
    document.getElementById('new-memo')?.focus()
  }, [setPanel])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'm'
      ) {
        event.preventDefault()
        writeMemo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [writeMemo])

  return writeMemo
}
