export type LlmRoute = 'server' | 'local'

export type LlmSettings = {
  route: LlmRoute
  bridgeUrl: string
}

type StorageAdapter = Pick<Storage, 'getItem' | 'setItem'>

const routeStorageKey = 'blog-writer.llm.route'
const bridgeUrlStorageKey = 'blog-writer.llm.bridge-url'

export function loadLlmSettings(storage: StorageAdapter): LlmSettings {
  const savedRoute = storage.getItem(routeStorageKey)

  return {
    route: savedRoute === 'local' ? 'local' : 'server',
    bridgeUrl: storage.getItem(bridgeUrlStorageKey) ?? '',
  }
}

export function saveLlmSettings(
  storage: StorageAdapter,
  settings: LlmSettings,
) {
  storage.setItem(routeStorageKey, settings.route)
  storage.setItem(bridgeUrlStorageKey, settings.bridgeUrl)
}
