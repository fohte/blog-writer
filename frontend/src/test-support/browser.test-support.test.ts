export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}

export function dispatchDragEvents(
  source: HTMLElement,
  target: HTMLElement,
  position?: { x: number; y: number },
): void {
  const bounds = target.getBoundingClientRect()
  const dataTransfer = new DataTransfer()
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    clientX: position?.x ?? bounds.left + bounds.width / 2,
    clientY: position?.y ?? bounds.top + bounds.height / 2,
    dataTransfer,
  }
  source.dispatchEvent(new DragEvent('dragstart', eventOptions))
  target.dispatchEvent(new DragEvent('dragenter', eventOptions))
  target.dispatchEvent(new DragEvent('dragover', eventOptions))
  target.dispatchEvent(new DragEvent('drop', eventOptions))
  source.dispatchEvent(new DragEvent('dragend', eventOptions))
}
