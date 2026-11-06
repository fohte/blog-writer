import { Panel } from '@fohte/ui/panel'

type FileSyncSettingsSectionProps = {
  directory: string
}

export function FileSyncSettingsSection({
  directory,
}: FileSyncSettingsSectionProps) {
  return (
    <section
      aria-labelledby="file-sync-settings-heading"
      className="flex flex-col gap-4"
    >
      <h2 className="text-xl font-semibold" id="file-sync-settings-heading">
        ローカルファイル同期
      </h2>
      <Panel className="flex flex-col gap-2 rounded-lg p-4">
        <span className="font-medium">同期フォルダー</span>
        <code className="break-all text-sm text-muted-foreground">
          {directory}
        </code>
      </Panel>
    </section>
  )
}
