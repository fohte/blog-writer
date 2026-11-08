import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { ResultAsync } from 'neverthrow'

export type ArticleImageUploadError = { message: string }

export type ArticleImageUploader = (
  file: File,
) => ResultAsync<{ src: string }, ArticleImageUploadError>

type UploadPosition = { from: number; to: number }

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
    const position =
      this.view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
      this.view.state.selection.main.from
    void this.upload(files, uploader, { from: position, to: position })
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
    this.view.dispatch({
      changes: { from, to, insert: markdown },
      selection: { anchor: from + markdown.length },
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
