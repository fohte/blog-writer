import type { OgpResponse } from '#lib/ogp-api'

export interface MdxCardLinkPreviewProps {
  href: string
  ogp?: OgpResponse
}

function cardUrl(href: string): URL | null {
  const parsed = URL.canParse(href) ? new URL(href) : null
  return parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:')
    ? parsed
    : null
}

function collapseDescription(description: string): string {
  const value = description.substring(0, 80)
  return description === value ? value : `${value}…`
}

export function createMdxCardLinkPreview({
  href,
  ogp,
}: MdxCardLinkPreviewProps): HTMLElement {
  const url = cardUrl(href)
  const card = document.createElement('a')
  card.className =
    'my-4 flex items-center justify-center gap-6 overflow-hidden border border-border px-4 py-4 no-underline transition-colors hover:border-muted-foreground'
  card.dataset['mdxCardLink'] = ''
  card.draggable = false
  card.href = href
  card.target = '_blank'
  card.rel = 'noopener noreferrer'

  if (ogp?.available === true && ogp.image !== null && ogp.image.length > 0) {
    const imageBox = document.createElement('div')
    imageBox.className =
      'flex max-w-[min(40%,250px)] min-w-[min(20%,150px)] items-center justify-center'
    const image = document.createElement('img')
    image.className = 'h-full max-h-[200px] object-cover'
    image.alt = ''
    image.draggable = false
    image.referrerPolicy = 'no-referrer'
    image.src = ogp.image
    image.addEventListener(
      'error',
      () => {
        imageBox.remove()
      },
      { once: true },
    )
    imageBox.append(image)
    card.append(imageBox)
  }

  const details = document.createElement('div')
  details.className = 'flex-1'
  const title = document.createElement('p')
  title.className =
    'font-[family-name:var(--font-mono-ui)] text-[15px] font-bold'
  title.textContent =
    ogp?.available === true && ogp.title !== null && ogp.title.length > 0
      ? ogp.title
      : href
  details.append(title)

  const domain = document.createElement('p')
  domain.className = 'text-sm text-muted-foreground'
  domain.textContent = url?.hostname ?? href
  details.append(domain)

  if (
    ogp?.available === true &&
    ogp.description !== null &&
    ogp.description.length > 0
  ) {
    const description = document.createElement('p')
    description.className = 'mt-1 text-xs text-muted-foreground-strong'
    description.textContent = collapseDescription(ogp.description)
    details.append(description)
  }

  card.append(details)
  return card
}
