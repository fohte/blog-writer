export function formatCheckedAt(value: string | null): string | undefined {
  if (value === null || value.length === 0) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString().slice(0, 10)
}

export function getSourceHost(url: string): string | undefined {
  return url.match(/^https?:\/\/([^/:?#]+)/i)?.[1]
}
