import { useState } from 'react'

import type { Heading } from '#article/types'
import { HeadingResearchOutlineView } from '#components/heading-research-outline-view'
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
    <HeadingResearchOutlineView
      busy={busy}
      heading={activeHeading}
      onResearch={(question) => {
        if (activeHeading) onResearch(activeHeading.text, question)
      }}
    >
      <OutlineProposalAccessory
        {...context}
        onActiveHeadingChange={setActiveHeading}
      />
    </HeadingResearchOutlineView>
  )
}
