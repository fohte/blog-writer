export function memoIdFrom(source: { data: Record<string, unknown> }) {
  return source.data['kind'] === 'memo' &&
    typeof source.data['memoId'] === 'string'
    ? source.data['memoId']
    : undefined
}
