import { Button } from '@fohte/ui/button'
import { Input } from '@fohte/ui/input'
import { Panel } from '@fohte/ui/panel'
import { SegmentedControl } from '@fohte/ui/segmented-control'

import type { LlmRoute, LlmSettings } from '#lib/llm-settings'

type LlmSettingsViewProps = {
  settings: LlmSettings
  status: 'loading' | 'ready' | 'error'
  locked: boolean
  storageError: boolean
  error?: string | undefined
  onBack: () => void
  onRouteChange: (route: LlmRoute) => void
  onBridgeUrlChange: (url: string) => void
}

const routeOptions = [
  { value: 'server', label: 'Server' },
  { value: 'local', label: 'Local' },
] as const

export function LlmSettingsView({
  settings,
  status,
  locked,
  storageError,
  error,
  onBack,
  onRouteChange,
  onBridgeUrlChange,
}: LlmSettingsViewProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex items-center gap-4">
        <Button onClick={onBack} type="button" variant="outline">
          Back
        </Button>
        <h1 className="text-3xl font-bold">Settings</h1>
      </header>

      <section
        aria-labelledby="llm-settings-heading"
        className="flex flex-col gap-4"
      >
        <h2 className="text-xl font-semibold" id="llm-settings-heading">
          LLM
        </h2>

        {status === 'loading' ? (
          <p aria-live="polite" className="text-muted-foreground" role="status">
            Loading LLM settings…
          </p>
        ) : status === 'error' ? (
          <p role="alert">{error ?? 'Unable to load LLM settings.'}</p>
        ) : locked ? (
          <Panel className="rounded-lg p-4">
            <p className="text-muted-foreground">
              LLM settings are managed by the server.
            </p>
          </Panel>
        ) : (
          <Panel className="flex flex-col gap-5 rounded-lg p-4">
            <div className="flex flex-col gap-2">
              <span className="font-medium" id="llm-route-label">
                Execution route
              </span>
              <SegmentedControl
                aria-labelledby="llm-route-label"
                onValueChange={onRouteChange}
                options={routeOptions}
                value={settings.route}
              />
            </div>

            {settings.route === 'local' ? (
              <div className="flex flex-col gap-2">
                <label className="font-medium" htmlFor="llm-bridge-url">
                  Bridge URL
                </label>
                <Input
                  autoComplete="url"
                  id="llm-bridge-url"
                  onChange={(event) => {
                    onBridgeUrlChange(event.currentTarget.value)
                  }}
                  placeholder="http://localhost:4141"
                  type="url"
                  value={settings.bridgeUrl}
                />
              </div>
            ) : null}
          </Panel>
        )}

        {storageError ? (
          <p role="alert">Settings could not be saved on this device.</p>
        ) : null}
      </section>
    </main>
  )
}
