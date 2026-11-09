export interface MarkdownEditorImageUploadErrorProps {
  message: string
}

export function MarkdownEditorImageUploadError({
  message,
}: MarkdownEditorImageUploadErrorProps) {
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  )
}
