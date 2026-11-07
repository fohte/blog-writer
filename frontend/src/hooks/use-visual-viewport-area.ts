import { useEffect, useState } from 'react'

type VisualViewportArea = { top: number; height: number }

function readArea(): VisualViewportArea | undefined {
  const viewport = window.visualViewport
  if (!viewport) return undefined
  if (
    viewport.offsetTop === 0 &&
    Math.abs(viewport.height - window.innerHeight) < 1
  )
    return undefined
  return { top: viewport.offsetTop, height: viewport.height }
}

/**
 * Returns the visible part of the layout viewport while it is smaller, as when
 * an on-screen keyboard is open; iOS Safari keeps `dvh` at the full height then.
 */
export function useVisualViewportArea(): VisualViewportArea | undefined {
  const [area, setArea] = useState(readArea)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      setArea(readArea())
    }
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return area
}
