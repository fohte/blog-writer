import { ResultAsync } from 'neverthrow'

export interface MermaidPreviewProps {
  id: string
  source: string
  showSource?: boolean
}

function renderMermaidDiagram(id: string, source: string) {
  return ResultAsync.fromPromise(
    import('mermaid')
      .then(({ default: mermaid }) => mermaid.render(id, source))
      .then(({ svg }) => svg),
    (error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
  )
}

function createSourceElement(source: string): HTMLElement {
  const sourceElement = document.createElement('pre')
  sourceElement.className = 'overflow-x-auto rounded bg-muted/40 p-2 text-xs'
  const code = document.createElement('code')
  code.textContent = source
  sourceElement.append(code)
  return sourceElement
}

function createErrorElement(message: string): HTMLElement {
  const error = document.createElement('p')
  error.className = 'text-sm text-destructive'
  error.setAttribute('role', 'alert')
  error.textContent = message
  return error
}

function createDiagramElement(svg: string): HTMLElement {
  const container = document.createElement('div')
  container.className = 'overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-full'
  container.innerHTML = svg
  return container
}

export function createMermaidPreviewElement({
  id,
  source,
  showSource = false,
}: MermaidPreviewProps): HTMLElement {
  const figure = document.createElement('figure')
  figure.className = 'my-2 rounded-md border bg-background p-3'
  const loading = document.createElement('p')
  loading.setAttribute('aria-busy', 'true')
  loading.className = 'text-sm text-muted-foreground'
  loading.textContent = 'Drawing diagram…'
  if (showSource) figure.append(createSourceElement(source))
  figure.append(loading)

  void renderMermaidDiagram(id, source).match(
    (svg) => {
      figure.replaceChildren(
        ...(showSource ? [createSourceElement(source)] : []),
        createDiagramElement(svg),
      )
    },
    (error) => {
      figure.replaceChildren(
        createSourceElement(source),
        createErrorElement(error.message),
      )
    },
  )
  return figure
}
