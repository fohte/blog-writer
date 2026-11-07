export type RejectedSuggestion =
  | { kind: 'add'; heading: string }
  | { kind: 'rename'; original: string; replacement: string }
  | { kind: 'delete'; original: string }

export type ProposalContent = {
  from: number
  to: number
  replacement: string
  original: string
}

export function rejectionKey(suggestion: ProposalContent): RejectedSuggestion {
  if (suggestion.from === suggestion.to) {
    return {
      kind: 'add',
      heading: suggestion.replacement.replace(/\n$/u, ''),
    }
  }
  if (suggestion.replacement === '') {
    return { kind: 'delete', original: suggestion.original }
  }
  return {
    kind: 'rename',
    original: suggestion.original,
    replacement: suggestion.replacement,
  }
}

export function sameRejectedSuggestion(
  left: RejectedSuggestion,
  right: RejectedSuggestion,
): boolean {
  if (left.kind !== right.kind) return false
  switch (left.kind) {
    case 'add':
      return right.kind === 'add' && left.heading === right.heading
    case 'rename':
      return (
        right.kind === 'rename' &&
        left.original === right.original &&
        left.replacement === right.replacement
      )
    case 'delete':
      return right.kind === 'delete' && left.original === right.original
  }
}
