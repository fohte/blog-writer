export interface MarkdownImagePreviewProps {
  alt: string
  source: string
  src: string
  failed?: boolean
}

export function createMarkdownImagePreview({
  alt,
  source,
  src,
  failed = false,
}: MarkdownImagePreviewProps): HTMLElement {
  const fallback = () => {
    const code = document.createElement('code')
    code.className =
      'block whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm'
    code.textContent = source
    return code
  }
  if (failed) return fallback()

  const figure = document.createElement('figure')
  figure.className = 'my-2 flex justify-center'
  const image = document.createElement('img')
  image.alt = alt
  image.className = 'max-h-128 max-w-full rounded-md object-contain'
  image.referrerPolicy = 'no-referrer'
  image.setAttribute('src', src)
  image.addEventListener(
    'error',
    () => {
      figure.replaceChildren(fallback())
    },
    { once: true },
  )
  figure.append(image)
  return figure
}
