import { useState } from 'react'

import type { Heading } from '#article/types'
import { HeadingResearchAccessory } from '#components/heading-research-accessory'
import {
  OutlineProposalAccessory,
  type OutlineProposalAccessoryContext,
} from '#proposals/outline'

type HeadingResearchOutlineProps = OutlineProposalAccessoryContext & {
  busy: boolean
  onResearch: (headingText: string, question: string) => void
}

export function HeadingResearchOutline({
  busy,
  onResearch,
  ...context
}: HeadingResearchOutlineProps) {
  const [activeHeading, setActiveHeading] = useState<Heading>()

  return (
    <div className="flex flex-col gap-4">
      <HeadingResearchAccessory
        busy={busy}
        heading={activeHeading}
        onResearch={(question) => {
          if (activeHeading) onResearch(activeHeading.text, question)
        }}
      />
      <OutlineProposalAccessory
        {...context}
        onActiveHeadingChange={setActiveHeading}
      />
    </div>
  )
}
