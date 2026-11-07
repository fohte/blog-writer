import type { ReactNode } from 'react'

import type { Heading } from '#article/types'
import { HeadingResearchAccessory } from '#components/heading-research-accessory'

type HeadingResearchOutlineViewProps = {
  heading?: Heading | undefined
  busy: boolean
  onResearch: (question: string) => void
  children: ReactNode
}

export function HeadingResearchOutlineView({
  heading,
  busy,
  onResearch,
  children,
}: HeadingResearchOutlineViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <HeadingResearchAccessory
        busy={busy}
        heading={heading}
        onResearch={onResearch}
      />
      {children}
    </div>
  )
}
