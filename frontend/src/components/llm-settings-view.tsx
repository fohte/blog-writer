import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { SegmentedControl } from '@fohte/ui/segmented-control'

import { AppHeader } from '#components/app-header'
import { FileSyncSettingsSection } from '#components/file-sync-settings-section'
import type { LlmRoute, LlmSettings } from '#lib/llm-settings'

type LlmSettingsViewProps = {
  settings: LlmSettings
  status: 'loading' | 'ready' | 'error'
  locked: boolean
  unsaved: boolean
  bridgeUnreachable: boolean
  storageError: 'load' | 'save' | undefined
  onBack: () => void
  onRouteChange: (route: LlmRoute) => void
  onBridgeUrlChange: (url: string) => void
  onSave: () => void
  fileSyncDirectory?: string | undefined
  fileSyncConfigurationError?: string | undefined
}

const routeOptions = [
  { value: 'server', label: 'サーバー (既定)' },
  { value: 'local', label: 'ローカル (この PC の中継)' },
] as const

export function LlmSettingsView({
  settings,
  status,
  locked,
  unsaved,
  bridgeUnreachable,
  storageError,
  onBack,
  onRouteChange,
  onBridgeUrlChange,
  onSave,
  fileSyncDirectory,
  fileSyncConfigurationError,
}: LlmSettingsViewProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader onHome={onBack} />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-8">
        <h1 className="text-sm font-bold">
          設定{' '}
          <span className="font-normal text-muted-foreground">
            (この端末だけ)
          </span>
        </h1>

        <section
          aria-labelledby="llm-route-heading"
          className="flex flex-col gap-2 text-xs"
        >
          <h2
            className="font-bold text-muted-foreground"
            id="llm-route-heading"
          >
            LLM の経路
          </h2>
          {status === 'loading' ? (
            <p className="text-muted-foreground" role="status">
              読み込み中…
            </p>
          ) : status === 'error' ? (
            <p className="text-destructive" role="alert">
              LLM の設定を読み込めませんでした。
            </p>
          ) : locked ? (
            <p className="text-muted-foreground">
              この環境では経路が決められています。
            </p>
          ) : (
            <>
              {/* SegmentedControl takes no className, and a flex column would stretch it. */}
              <div>
                <SegmentedControl
                  aria-labelledby="llm-route-heading"
                  onValueChange={onRouteChange}
                  options={routeOptions}
                  value={settings.route}
                />
              </div>
              {settings.route === 'local' ? (
                <div className="flex flex-col gap-1.5">
                  <label className="text-muted-foreground" htmlFor="bridge-url">
                    中継の URL
                  </label>
                  <Input
                    aria-describedby={
                      bridgeUnreachable ? 'bridge-url-error' : undefined
                    }
                    aria-invalid={bridgeUnreachable}
                    autoComplete="url"
                    className="font-mono"
                    id="bridge-url"
                    onChange={(event) => {
                      onBridgeUrlChange(event.currentTarget.value)
                    }}
                    placeholder="http://127.0.0.1:4312"
                    type="url"
                    value={settings.bridgeUrl}
                  />
                  {bridgeUnreachable ? (
                    <p id="bridge-url-error" role="alert">
                      <span
                        aria-hidden="true"
                        className="font-mono text-destructive"
                      >
                        !{' '}
                      </span>
                      接続できません
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>

        <FileSyncSettingsSection
          directory={fileSyncDirectory}
          error={fileSyncConfigurationError}
        />

        {storageError === undefined ? null : (
          <p className="text-xs text-destructive" role="alert">
            {storageError === 'load'
              ? 'この端末から設定を読み込めませんでした。'
              : 'この端末に設定を保存できませんでした。'}
          </p>
        )}

        {status === 'ready' && !locked ? (
          <div className="flex items-center gap-3 border-t border-border pt-3 text-xs">
            <span className="flex-1 text-muted-foreground" role="status">
              {unsaved ? '未保存の変更あり' : '保存済み'}
            </span>
            <Button
              disabled={!unsaved}
              onClick={onSave}
              size="sm"
              type="button"
              variant="solid"
            >
              保存
            </Button>
          </div>
        ) : null}
      </main>
    </div>
  )
}
