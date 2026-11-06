import type { Meta, StoryObj } from '@storybook/react-vite'

import type { Source } from '#article/types'
import {
  ClaimEvidenceCard,
  type ClaimEvidenceCardProps,
} from '#components/claim-evidence-card'

const source: Source = {
  id: 'source-example',
  kind: 'url',
  title: 'Example research report',
  url: 'https://example.invalid/report',
  fileName: null,
  checkedAt: '2026-02-01T00:00:00.000Z',
  status: 'ready',
  summary: 'The report describes a measured change over time.',
}

const common = {
  source,
  quote: 'The measured value increased during the study period.',
  checkedAt: '2026-02-01T00:00:00.000Z',
  publishedAt: '2025-10-01',
  open: true,
} satisfies Omit<ClaimEvidenceCardProps, 'verdict' | 'edited'>

const meta = {
  title: 'Research/ClaimEvidenceCard',
  component: ClaimEvidenceCard,
} satisfies Meta<typeof ClaimEvidenceCard>

export default meta
type Story = StoryObj<typeof meta>

export const Supported: Story = {
  name: 'the source directly supports the sentence.',
  args: { ...common, verdict: 'supported' },
}

export const Insufficient: Story = {
  name: 'the source does not provide enough support.',
  args: { ...common, verdict: 'insufficient' },
}

export const Outdated: Story = {
  name: 'the source may be out of date.',
  args: { ...common, verdict: 'outdated' },
}

export const Contradicted: Story = {
  name: 'the source contradicts the sentence.',
  args: { ...common, verdict: 'contradicted' },
}

export const EditedAfterCheck: Story = {
  name: 'the checked sentence has changed since review.',
  args: { ...common, verdict: 'supported', edited: true },
}

export const SummaryUnavailable: Story = {
  name: 'the source has no generated summary.',
  args: {
    ...common,
    source: { ...source, summary: '' },
    verdict: 'supported',
    publishedAt: null,
  },
}
