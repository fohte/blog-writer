import { useCallback, useEffect, useState } from 'react'

export function useOutlineMode(initial: boolean, available: boolean) {
  const [outlineMode, setOutlineMode] = useState(initial)

  useEffect(() => {
    if (!available) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'o'
      ) {
        event.preventDefault()
        setOutlineMode((current) => !current)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [available])

  const leaveOutlineMode = useCallback(() => {
    setOutlineMode(false)
  }, [])

  return { writingOutline: outlineMode && available, leaveOutlineMode }
}
