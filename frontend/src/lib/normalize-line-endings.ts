export function normalizeLineEndings(value: string) {
  return value.replaceAll('\r\n', '\n')
}
