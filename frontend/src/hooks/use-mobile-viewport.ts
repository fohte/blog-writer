import { useSyncExternalStore } from 'react'

const mobileQuery = '(max-width: 767px)'

function subscribe(listener: () => void) {
  const media = window.matchMedia(mobileQuery)
  media.addEventListener('change', listener)
  return () => {
    media.removeEventListener('change', listener)
  }
}

function getSnapshot() {
  return window.matchMedia(mobileQuery).matches
}

export function useMobileViewport() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
