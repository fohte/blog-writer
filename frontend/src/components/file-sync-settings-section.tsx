type FileSyncSettingsSectionProps = {
  directory?: string | undefined
  error?: string | undefined
}

export function FileSyncSettingsSection({
  directory,
  error,
}: FileSyncSettingsSectionProps) {
  if (directory === undefined && error === undefined) return null

  return (
    <section
      aria-labelledby="file-sync-settings-heading"
      className="flex flex-col gap-1 text-xs"
    >
      <h2
        className="font-bold text-muted-foreground"
        id="file-sync-settings-heading"
      >
        本文ファイルの同期先フォルダー
      </h2>
      {error !== undefined ? (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <code className="break-all font-mono">{directory}</code>
      )}
    </section>
  )
}
