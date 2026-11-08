import type { Heading } from '#article/types'

export type MoveConflictDestination = {
  section: string
  parent?: string
}

// A position equal to a heading's start follows the previous section's last character, so that heading does not contain it.
function headingPath(
  headings: readonly Heading[],
  position: number,
): Heading[] {
  const current = headings.findLast(({ from }) => from < position)
  return current ? [current, ...headingPath(current.children, position)] : []
}

function headingLabel({ level, text }: Heading): string {
  return `${'#'.repeat(level)} ${text || '無題の見出し'}`
}

export function moveConflictDestination(
  headings: readonly Heading[],
  target: number,
): MoveConflictDestination | undefined {
  const path = headingPath(headings, target)
  const section = path.at(-1)
  if (!section) return undefined
  const parent = path.at(-2)
  return parent
    ? { section: headingLabel(section), parent: headingLabel(parent) }
    : { section: headingLabel(section) }
}

export function countMoveConflictsByHeading(
  headings: readonly Heading[],
  conflicts: ReadonlyArray<{ from: number }>,
): Record<number, number> {
  const counts: Record<number, number> = {}
  for (const { from } of conflicts) {
    const heading = headingPath(headings, from).at(-1)
    if (heading) counts[heading.from] = (counts[heading.from] ?? 0) + 1
  }
  return counts
}
