export class SyncClientError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'SyncClientError'
  }
}

export const toSyncClientError = (cause: unknown) =>
  cause instanceof SyncClientError
    ? cause
    : new SyncClientError(
        'Failed to initialize document synchronization',
        cause,
      )
