export interface MdxImageGridPreviewProps {
  images: HTMLElement[]
}

export function createMdxImageGridPreview({
  images,
}: MdxImageGridPreviewProps): HTMLElement {
  const grid = document.createElement('div')
  grid.className =
    'mt-4 grid grid-cols-1 items-center gap-4 sm:auto-cols-fr sm:grid-flow-col [&>figure]:mt-0'
  grid.append(...images)
  return grid
}
