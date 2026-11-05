import type { Meta, StoryObj } from '@storybook/react-vite'

import { ResearchSourceCard } from '#components/research-source-card'

const meta = {
  component: ResearchSourceCard,
  args: {
    source: {
      id: 'source-a',
      kind: 'url',
      title: '公開統計の概要',
      url: 'https://data.example.invalid/report',
      fileName: null,
      checkedAt: '2026-01-14T00:00:00.000Z',
      status: 'ready',
      summary: '調査結果の概要を説明しています。',
    },
    finding: {
      id: 'finding-a',
      sourceId: 'source-a',
      text: '利用者数は前年より増加しました。',
      quote: '利用者数は前年より 12% 増加しました。',
    },
    open: true,
  },
} satisfies Meta<typeof ResearchSourceCard>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  name: '資料カードに引用と要約を表示する',
}
