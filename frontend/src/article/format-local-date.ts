export function formatLocalDate(time: number) {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

export function formatLocalTime(time: number) {
  return new Date(time).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}
