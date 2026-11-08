import { flattenHeadingTree, type Heading } from '#article/index'

const MAX_HEADING_LEVEL = 6
const LEVEL_WITHOUT_HEADINGS = 2

export type NewHeadingPlacement = {
  /** The heading whose section receives the new heading. */
  anchor: Pick<Heading, 'level' | 'text'> | undefined
  /** Omitted when the new heading goes at the end of the article. */
  beforeFrom: number | undefined
  levels: number[]
  defaultLevel: number
}

function selectableLevels(level: number) {
  return level < MAX_HEADING_LEVEL ? [level, level + 1] : [level]
}

export function resolveNewHeadingPlacement(
  headings: Heading[],
  cursor: number,
): NewHeadingPlacement {
  const flatHeadings = flattenHeadingTree(headings)
  const anchor = flatHeadings.findLast(({ from }) => from <= cursor)
  if (anchor === undefined) {
    const level = flatHeadings.at(-1)?.level ?? LEVEL_WITHOUT_HEADINGS
    return {
      anchor: undefined,
      beforeFrom: undefined,
      levels: selectableLevels(level),
      defaultLevel: level,
    }
  }

  const levels = selectableLevels(anchor.level)
  return {
    anchor: { level: anchor.level, text: anchor.text },
    beforeFrom: flatHeadings.find(
      ({ from, level }) => from > anchor.from && level <= anchor.level,
    )?.from,
    levels,
    defaultLevel: levels.at(-1) ?? anchor.level,
  }
}
