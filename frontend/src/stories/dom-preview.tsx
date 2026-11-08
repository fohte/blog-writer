import { useLayoutEffect, useRef } from 'react'

export function DOMPreview<Props>({
  createElement,
  props,
}: {
  createElement: (props: Props) => HTMLElement
  props: Props
}) {
  const container = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    element.replaceChildren(createElement(props))
    return () => {
      element.replaceChildren()
    }
  }, [createElement, props])

  return <div ref={container} />
}
