import type { Meta, StoryObj } from '@storybook/react-vite'

import { ResearchProgress } from '#components/research-progress'

const meta = {
  component: ResearchProgress,
  args: {
    queries: ['利用状況の最新統計'],
    onCancel: () => {},
  },
} satisfies Meta<typeof ResearchProgress>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {
  name: '検索と取得の進捗を表示する',
  args: {
    status: 'running',
    defaultOpen: true,
  },
}

export const Interrupted: Story = {
  name: '中止した調査に未保存であることを示す',
  args: {
    status: 'interrupted',
    defaultOpen: true,
  },
}

export const InterruptedWithPreservedSources: Story = {
  name: '共同編集で使われた資料を保持したことを示す',
  args: {
    status: 'interrupted',
    interruptedMessage:
      '調査を中断しました。共同編集の情報を守るため、関連する資料を保持しました。',
    defaultOpen: true,
  },
}

export const ConnectionInterrupted: Story = {
  name: '接続中断の理由も表示する',
  args: {
    status: 'interrupted',
    error: '調査の接続が中断されました。',
    defaultOpen: true,
  },
}

export const Cancelling: Story = {
  name: '調査の中止処理中であることを示す',
  args: {
    status: 'cancelling',
    defaultOpen: true,
  },
}
