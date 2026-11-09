import { ResultAsync } from 'neverthrow'

type Mermaid = typeof import('mermaid').default

export interface MermaidPreviewProps {
  id: string
  source: string
  showSource?: boolean
}

let mermaidPromise: Promise<Mermaid> | undefined

function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: {
        background: '#0a0a0a',
        activationBkgColor: '#141414',
        activationBorderColor: '#71717a',
        darkMode: true,
        edgeLabelBackground: '#0a0a0a',
        lineColor: '#ef4444',
        mainBkg: '#141414',
        nodeBorder: '#71717a',
        noteBkgColor: '#141414',
        noteBorderColor: '#71717a',
        noteTextColor: '#fafafa',
        primaryBorderColor: '#71717a',
        primaryColor: '#141414',
        primaryTextColor: '#fafafa',
        textColor: '#fafafa',
      },
    })
    return mermaid
  })
  return mermaidPromise
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof error.message === 'string')
      return new Error(error.message)
    if ('str' in error && typeof error.str === 'string')
      return new Error(error.str)
  }
  return new Error(String(error))
}

function renderMermaidDiagram(id: string, source: string) {
  return ResultAsync.fromPromise(
    loadMermaid()
      .then((mermaid) => mermaid.render(id, source))
      .then(({ svg }) => svg),
    toError,
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

export function createMermaidPreviewElement(
  { id, source, showSource = false }: MermaidPreviewProps,
  onRendered?: () => void,
): HTMLElement {
  const figure = document.createElement('figure')
  figure.className = 'rounded-md border bg-background px-3 py-5'
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
      onRendered?.()
    },
    (error) => {
      figure.replaceChildren(
        createSourceElement(source),
        createErrorElement(error.message),
      )
      onRendered?.()
    },
  )
  return figure
}
