import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { ResultAsync } from 'neverthrow'

import { getBlockWidgetSourceRange } from '#editor/block-widget'

type ArticleImageUploadError = { message: string }

export type ArticleImageUploader = (
  file: File,
) => ResultAsync<{ src: string }, ArticleImageUploadError>

type UploadPosition = {
  from: number
  standaloneBlock?: boolean
  to: number
}

function lineBreaksAtEnd(value: string): number {
  let count = 0
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] !== '\n') break
    count += 1
  }
  return count
}

function lineBreaksAtStart(value: string): number {
  let count = 0
  for (const character of value) {
    if (character !== '\n') break
    count += 1
  }
  return count
}

function standaloneBlockInsertion(
  before: string,
  after: string,
  markdown: string,
): { insert: string; cursorOffset: number } {
  const prefix = '\n'.repeat(Math.max(0, 2 - lineBreaksAtEnd(before)))
  const suffix = '\n'.repeat(Math.max(0, 2 - lineBreaksAtStart(after)))
  return {
    insert: prefix + markdown + suffix,
    cursorOffset: prefix.length + markdown.length,
  }
}

class ImageUploadPlugin {
  private readonly pending = new Set<UploadPosition>()
  private disposed = false

  constructor(
    private readonly view: EditorView,
    private readonly uploader: () => ArticleImageUploader | undefined,
    private readonly onError: (message: string) => void,
    private readonly clearError: () => void,
  ) {}

  update(update: ViewUpdate): void {
    if (!update.docChanged) return
    for (const position of this.pending) {
      position.from = update.changes.mapPos(position.from, 1)
      position.to = update.changes.mapPos(position.to, -1)
    }
  }

  paste(event: ClipboardEvent): boolean {
    const files = this.imageFiles(event.clipboardData?.files)
    const uploader = this.uploader()
    if (files.length === 0) return false
    event.preventDefault()
    if (!uploader) return true
    void this.upload(files, uploader, {
      from: this.view.state.selection.main.from,
      to: this.view.state.selection.main.to,
    })
    return true
  }

  drop(event: DragEvent): boolean {
    const files = this.imageFiles(event.dataTransfer?.files)
    const uploader = this.uploader()
    if (files.length === 0) return false
    event.preventDefault()
    if (!uploader) return true
    const widgetRange = getBlockWidgetSourceRange(event.target)
    const validWidgetRange =
      widgetRange &&
      widgetRange.from >= 0 &&
      widgetRange.from <= widgetRange.to &&
      widgetRange.to <= this.view.state.doc.length
        ? widgetRange
        : undefined
    const position =
      validWidgetRange?.to ??
      this.view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
      this.view.state.selection.main.from
    void this.upload(files, uploader, {
      from: position,
      to: position,
      ...(validWidgetRange ? { standaloneBlock: true } : {}),
    })
    return true
  }

  destroy(): void {
    this.disposed = true
    this.pending.clear()
  }

  private imageFiles(files: FileList | null | undefined): File[] {
    return [...(files ?? [])].filter((file) => file.type.startsWith('image/'))
  }

  private async upload(
    files: File[],
    uploader: ArticleImageUploader,
    position: UploadPosition,
  ): Promise<void> {
    this.clearError()
    this.pending.add(position)
    const results = await Promise.all(
      files.map((file) =>
        uploader(file).match(
          (image) => ({ src: image.src }),
          (error) => ({ error }),
        ),
      ),
    )
    this.pending.delete(position)
    if (this.disposed) return

    const failure = results.find((result) => 'error' in result)
    if (failure && 'error' in failure) {
      this.onError(failure.error.message)
      return
    }

    const markdown = results
      .flatMap((result) => ('src' in result ? [result.src] : []))
      .map((src) => `![](${src})`)
      .join('\n')
    const from = Math.min(position.from, this.view.state.doc.length)
    const to = Math.min(Math.max(position.to, from), this.view.state.doc.length)
    const insertion =
      position.standaloneBlock === true
        ? standaloneBlockInsertion(
            this.view.state.doc.sliceString(0, from),
            this.view.state.doc.sliceString(from),
            markdown,
          )
        : { insert: markdown, cursorOffset: markdown.length }
    this.view.dispatch({
      changes: { from, to, insert: insertion.insert },
      selection: { anchor: from + insertion.cursorOffset },
    })
  }
}

export function imageUploadExtension(
  uploader: () => ArticleImageUploader | undefined,
  onError: (message: string) => void,
  clearError: () => void,
) {
  const instances = new WeakMap<EditorView, ImageUploadPlugin>()
  return ViewPlugin.define(
    (view) => {
      const plugin = new ImageUploadPlugin(view, uploader, onError, clearError)
      instances.set(view, plugin)
      return plugin
    },
    {
      eventHandlers: {
        paste(event, view) {
          return instances.get(view)?.paste(event) ?? false
        },
        drop(event, view) {
          return instances.get(view)?.drop(event) ?? false
        },
      },
    },
  )
}
