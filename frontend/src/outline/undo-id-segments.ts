import * as Y from 'yjs'

export type IdSegment = {
  from: number
  to: number
  client: number
  clock: number
}

export type IdMapping = {
  fromClient: number
  fromClock: number
  toClient: number
  toClock: number
  length: number
}

export function captureVisibleSegments(
  body: Y.Text,
  from: number,
  to: number,
): IdSegment[] {
  const segments: IdSegment[] = []
  let position = 0
  for (let item = body._start; item; item = item.next) {
    if (item.deleted || !item.countable) continue
    const end = position + item.length
    const overlapFrom = Math.max(from, position)
    const overlapTo = Math.min(to, end)
    if (overlapFrom < overlapTo) {
      segments.push({
        from: overlapFrom - from,
        to: overlapTo - from,
        client: item.id.client,
        clock: item.id.clock + overlapFrom - position,
      })
    }
    position = end
  }
  return segments
}
