import { type Result as NeverthrowResult, Result } from 'neverthrow'

export type LlmRoute = 'server' | 'local'

export type LlmSettings = {
  route: LlmRoute
  bridgeUrl: string
}

export const defaultLlmSettings: LlmSettings = {
  route: 'server',
  bridgeUrl: '',
}

type StorageAdapter = Pick<Storage, 'getItem' | 'setItem'>
type StorageProvider = () => StorageAdapter

const routeStorageKey = 'blog-writer.llm.route'
const bridgeUrlStorageKey = 'blog-writer.llm.bridge-url'

export function loadLlmSettings(
  storageProvider: StorageProvider,
): NeverthrowResult<LlmSettings, Error> {
  return Result.fromThrowable(
    (): LlmSettings => {
      const storage = storageProvider()
      const savedRoute = storage.getItem(routeStorageKey)

      return {
        route: savedRoute === 'local' ? 'local' : 'server',
        bridgeUrl: storage.getItem(bridgeUrlStorageKey) ?? '',
      }
    },
    (cause) =>
      new Error('Failed to read LLM settings from local storage', { cause }),
  )()
}

export function saveLlmSettings(
  storageProvider: StorageProvider,
  settings: LlmSettings,
): NeverthrowResult<void, Error> {
  return Result.fromThrowable(
    () => {
      const storage = storageProvider()
      storage.setItem(routeStorageKey, settings.route)
      storage.setItem(bridgeUrlStorageKey, settings.bridgeUrl)
    },
    (cause) =>
      new Error('Failed to save LLM settings to local storage', { cause }),
  )()
}
