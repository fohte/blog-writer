import type { MouseEvent } from 'react'

export function stopButtonClickPropagation(
  event: MouseEvent<HTMLSpanElement>,
): void {
  if (
    event.target instanceof Element &&
    event.target.closest('button') !== null
  ) {
    event.stopPropagation()
  }
}
