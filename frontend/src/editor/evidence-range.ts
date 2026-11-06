const sentenceBoundary = /[.!?。！？](?:["'”’」』)\]]*)?(?=\s|$)/gu

function sentenceRangeAt(
  markdown: string,
  position: number,
): { from: number; to: number; claim: string } | undefined {
  const cursor = Math.max(0, Math.min(position, markdown.length))
  let from = 0
  let to = markdown.length
  for (const match of markdown.matchAll(sentenceBoundary)) {
    const end = match.index + match[0].length
    if (end <= cursor) from = end
    else {
      to = end
      break
    }
  }
  const lineStart = markdown.lastIndexOf('\n', Math.max(from, cursor - 1)) + 1
  const newline = markdown.indexOf('\n', cursor)
  if (newline !== -1) to = Math.min(to, newline)
  from = Math.max(from, lineStart)

  while (from < to && /\s/u.test(markdown[from] ?? '')) from += 1
  while (to > from && /\s/u.test(markdown[to - 1] ?? '')) to -= 1
  if (cursor < from || cursor > to || to <= from) return undefined
  const claim = markdown.slice(from, to)
  return claim.trim().length === 0 ? undefined : { from, to, claim }
}

function droppedUrl(
  dataTransfer: Pick<DataTransfer, 'getData'>,
): string | undefined {
  const uri = dataTransfer
    .getData('text/uri-list')
    .split(/\r?\n/u)
    .find((line) => line.length > 0 && !line.startsWith('#'))
  const candidate = (uri ?? dataTransfer.getData('text/plain')).trim()
  if (!/^https?:\/\/\S+$/iu.test(candidate)) return undefined
  return candidate
}

export function droppedClaim(
  markdown: string,
  dataTransfer: Pick<DataTransfer, 'getData'>,
  position: number,
): { url: string; from: number; to: number; claim: string } | undefined {
  const url = droppedUrl(dataTransfer)
  const range = sentenceRangeAt(markdown, position)
  return url !== undefined && range !== undefined
    ? { url, ...range }
    : undefined
}
