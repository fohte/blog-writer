import { Panel } from '@fohte/ui/panel'

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
      className="flex flex-col gap-4"
    >
      <h2 className="text-xl font-semibold" id="file-sync-settings-heading">
        ローカルファイル同期
      </h2>
      {error !== undefined ? (
        <Panel
          aria-live="assertive"
          className="rounded-lg border-destructive/40 bg-destructive/10 text-sm text-destructive"
          padding="sm"
          role="alert"
        >
          {error}
        </Panel>
      ) : (
        <Panel className="flex flex-col gap-2 rounded-lg p-4">
          <span className="font-medium">同期フォルダー</span>
          <code className="break-all text-sm text-muted-foreground">
            {directory}
          </code>
        </Panel>
      )}
    </section>
  )
}
