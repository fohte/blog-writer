export interface MdxKbdPreviewProps {
  value: string
}

export function createMdxKbdPreview({
  value,
}: MdxKbdPreviewProps): HTMLElement {
  const key = document.createElement('kbd')
  key.className =
    'rounded border border-border bg-card px-1.5 py-0.5 font-[family-name:var(--font-mono-ui)] text-sm font-normal'
  key.textContent = value
  return key
}
