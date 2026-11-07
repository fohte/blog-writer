import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'

import type { Source } from '#article/types'
import { ClaimEvidenceCard } from '#components/claim-evidence-card'

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
} satisfies Omit<ComponentProps<typeof ClaimEvidenceCard>, 'verdict' | 'edited'>

const meta = {
  title: 'Research/ClaimEvidenceCard',
  component: ClaimEvidenceCard,
} satisfies Meta<typeof ClaimEvidenceCard>

export default meta
type Story = StoryObj<typeof meta>

export const Supported: Story = {
  name: 'the card shows the supporting source with its quote and summary.',
  args: { ...common, verdict: 'supported' },
}

export const Insufficient: Story = {
  name: 'the card marks the sentence for review because the source lacks support.',
  args: { ...common, verdict: 'insufficient' },
}

export const InsufficientWithoutSource: Story = {
  name: 'the card marks the sentence for review and names no source.',
  args: {
    ...common,
    source: null,
    quote: '',
    verdict: 'insufficient',
    publishedAt: null,
  },
}

export const Outdated: Story = {
  name: 'the card marks the sentence for review because the source is outdated.',
  args: { ...common, verdict: 'outdated' },
}

export const Contradicted: Story = {
  name: 'the card marks the sentence for review because the source contradicts it.',
  args: { ...common, verdict: 'contradicted' },
}

export const EditedAfterCheck: Story = {
  name: 'the card marks the sentence for review because it was edited after the check.',
  args: { ...common, verdict: 'supported', edited: true },
}

export const InsufficientAfterEdit: Story = {
  name: 'the card lists both the missing support and the edit after the check.',
  args: { ...common, verdict: 'insufficient', edited: true },
}

export const SummaryUnavailable: Story = {
  name: 'the card shows an unknown publish date and no summary.',
  args: {
    ...common,
    source: { ...source, summary: '' },
    verdict: 'supported',
    publishedAt: null,
  },
}
