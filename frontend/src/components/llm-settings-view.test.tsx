import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LlmSettingsView } from '#components/llm-settings-view'

describe('LlmSettingsView', () => {
  it('hides route controls when the provider is locked', () => {
    const markup = renderToStaticMarkup(
      <LlmSettingsView
        locked
        onBack={() => {}}
        onBridgeUrlChange={() => {}}
        onRouteChange={() => {}}
        settings={{ route: 'local', bridgeUrl: 'http://localhost:4141' }}
        status="ready"
        storageError={false}
      />,
    )

    expect(markup).toEqual(
      String.raw`<main class="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12"><header class="flex items-center gap-4"><button type="button" tabindex="0" data-slot="button" class="group/button inline-flex shrink-0 items-center justify-center outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 aria-invalid:ring-destructive/40 [&amp;_svg]:pointer-events-none [&amp;_svg]:shrink-0 [&amp;_svg:not([class*=&#x27;size-&#x27;])]:size-4 rounded-lg border bg-clip-padding text-sm font-mono font-medium whitespace-nowrap transition-all focus-visible:border-ring active:translate-y-px aria-invalid:border-destructive/50 border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2">Back</button><h1 class="text-3xl font-bold">Settings</h1></header><section aria-labelledby="llm-settings-heading" class="flex flex-col gap-4"><h2 class="text-xl font-semibold" id="llm-settings-heading">LLM</h2><div data-slot="panel" class="border border-border rounded-lg p-4"><p class="text-muted-foreground">LLM settings are managed by the server.</p></div></section></main>`,
    )
  })
})
