import { flattenHeadingTreeWithDepth } from '#article/index'
import type { Heading } from '#article/types'
import { headingLevel } from '#components/outline-proposal-row'
import type { OutlineSuggestion } from '#proposals/outline'

export type FlatHeading = ReturnType<typeof flattenHeadingTreeWithDepth>[number]

type OutlineViewEntry =
  | {
      kind: 'heading'
      from: number
      heading: Heading
      depth: number
      proposal?: OutlineSuggestion
    }
  | {
      kind: 'addition'
      from: number
      proposal: OutlineSuggestion
      depth: number
    }

export function outlineViewEntries(
  headings: FlatHeading[],
  suggestions: readonly OutlineSuggestion[],
): OutlineViewEntry[] {
  const headingProposals = new Map(
    suggestions
      .filter((proposal) => proposal.from !== proposal.to)
      .map((proposal) => [proposal.anchorFrom ?? proposal.from, proposal]),
  )
  const additions = suggestions.filter(
    (proposal) => proposal.from === proposal.to,
  )
  return [
    ...headings.map(({ heading, depth }) => {
      const proposal = headingProposals.get(heading.from)
      return {
        kind: 'heading' as const,
        from: heading.from,
        heading,
        depth,
        ...(proposal === undefined ? {} : { proposal }),
      }
    }),
    ...additions.map((proposal) => ({
      kind: 'addition' as const,
      from: proposal.from,
      proposal,
      depth: headingLevel(proposal.replacement) - 1,
    })),
  ].sort((left, right) => left.from - right.from)
}

export function sectionEnd(
  headings: FlatHeading[],
  from: number,
  bodyLength: number,
) {
  const index = headings.findIndex(({ heading }) => heading.from === from)
  const current = headings[index]?.heading
  if (!current) return bodyLength
  return (
    headings
      .slice(index + 1)
      .find(({ heading }) => heading.level <= current.level)?.heading.from ??
    bodyLength
  )
}

export function siblingHeading(
  headings: FlatHeading[],
  from: number,
  direction: 'previous' | 'next',
): Heading | undefined {
  const index = headings.findIndex(({ heading }) => heading.from === from)
  const current = headings[index]
  if (!current) return undefined
  const step = direction === 'previous' ? -1 : 1
  for (
    let candidateIndex = index + step;
    candidateIndex >= 0;
    candidateIndex += step
  ) {
    const candidate = headings[candidateIndex]
    if (!candidate || candidate.depth < current.depth) return undefined
    if (candidate.depth === current.depth) return candidate.heading
  }
  return undefined
}
