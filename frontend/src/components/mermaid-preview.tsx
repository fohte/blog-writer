import { ResultAsync } from 'neverthrow'
import { useEffect, useId, useState } from 'react'

export interface MermaidPreviewProps {
  id?: string
  source: string
  showSource?: boolean
}

type DiagramResult =
  { kind: 'error'; message: string } | { kind: 'svg'; svg: string }

export function renderMermaidDiagram(id: string, source: string) {
  return ResultAsync.fromPromise(
    import('mermaid')
      .then(({ default: mermaid }) => mermaid.render(id, source))
      .then(({ svg }) => svg),
    (error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
  )
}

export function createMermaidPreviewElement(
  id: string,
  source: string,
): HTMLElement {
  const figure = document.createElement('figure')
  figure.className = 'my-2 rounded-md border bg-background p-3'
  const loading = document.createElement('p')
  loading.setAttribute('aria-busy', 'true')
  loading.className = 'text-sm text-muted-foreground'
  loading.textContent = 'Drawing diagram…'
  figure.append(loading)
  void renderMermaidDiagram(id, source).match(
    (svg) => {
      const container = document.createElement('div')
      container.className = 'overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-full'
      container.innerHTML = svg
      figure.replaceChildren(container)
    },
    (error) => {
      const sourceElement = document.createElement('pre')
      sourceElement.className =
        'overflow-x-auto rounded bg-muted/40 p-2 text-xs'
      const code = document.createElement('code')
      code.textContent = source
      sourceElement.append(code)
      const message = document.createElement('p')
      message.className = 'text-sm text-destructive'
      message.setAttribute('role', 'alert')
      message.textContent = error.message
      figure.replaceChildren(sourceElement, message)
    },
  )
  return figure
}

export function MermaidPreview({
  id: providedId,
  source,
  showSource = false,
}: MermaidPreviewProps) {
  const reactId = useId()
  const id =
    providedId ?? `markdown-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/gu, '')}`
  const [result, setResult] = useState<DiagramResult>()

  useEffect(() => {
    let active = true
    void renderMermaidDiagram(id, source).match(
      (svg) => {
        if (active) setResult({ kind: 'svg', svg })
      },
      (error) => {
        if (active) setResult({ kind: 'error', message: error.message })
      },
    )
    return () => {
      active = false
    }
  }, [id, source])

  return (
    <figure className="my-2 rounded-md border bg-background p-3">
      {showSource ? (
        <pre className="mb-3 overflow-x-auto rounded bg-muted/40 p-2 text-xs">
          <code>{source}</code>
        </pre>
      ) : null}
      {result?.kind === 'svg' ? (
        <div
          className="overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: result.svg }}
        />
      ) : result?.kind === 'error' ? (
        <div className="space-y-2" role="alert">
          {!showSource ? (
            <pre className="overflow-x-auto rounded bg-muted/40 p-2 text-xs">
              <code>{source}</code>
            </pre>
          ) : null}
          <p className="text-sm text-destructive">{result.message}</p>
        </div>
      ) : (
        <p aria-busy="true" className="text-sm text-muted-foreground">
          Drawing diagram…
        </p>
      )}
    </figure>
  )
}
