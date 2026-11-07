import { useSyncExternalStore } from 'react'

const coarsePointerQuery = '(pointer: coarse)'

function subscribe(listener: () => void) {
  const media = window.matchMedia(coarsePointerQuery)
  media.addEventListener('change', listener)
  return () => {
    media.removeEventListener('change', listener)
  }
}

function getSnapshot() {
  return window.matchMedia(coarsePointerQuery).matches
}

export function useCoarsePointer() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
