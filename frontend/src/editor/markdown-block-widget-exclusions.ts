import { type EditorState, Facet, StateEffect } from '@codemirror/state'

export type BlockWidgetExclusionRange = { from: number; to: number }

type BlockWidgetExclusionProvider = (
  state: EditorState,
) => readonly BlockWidgetExclusionRange[]

export const blockWidgetExclusionProviders = Facet.define<
  BlockWidgetExclusionProvider,
  readonly BlockWidgetExclusionProvider[]
>({ combine: (providers) => providers })

export const refreshBlockWidgetExclusions = StateEffect.define()

export function collectBlockWidgetExclusions(
  state: EditorState,
): BlockWidgetExclusionRange[] {
  return state
    .facet(blockWidgetExclusionProviders)
    .flatMap((provide) => provide(state))
}

export function equalBlockWidgetExclusionRanges(
  first: readonly BlockWidgetExclusionRange[],
  second: readonly BlockWidgetExclusionRange[],
): boolean {
  return (
    first.length === second.length &&
    first.every((range, index) => {
      const secondRange = second[index]
      return (
        secondRange !== undefined &&
        range.from === secondRange.from &&
        range.to === secondRange.to
      )
    })
  )
}
