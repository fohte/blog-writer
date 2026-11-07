import type { Meta, StoryObj } from '@storybook/react-vite'

import { ResearchProgress } from '#components/research-progress'

const meta = {
  component: ResearchProgress,
  args: {
    queries: ['利用状況の最新統計', '利用状況 2026 調査'],
    target: '利用状況',
    onCancel: () => {},
  },
} satisfies Meta<typeof ResearchProgress>

export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {
  name: '調べている見出しと検索語を、中止ボタンと一緒に表示する',
  args: {
    status: 'running',
  },
}

export const Starting: Story = {
  name: '検索語がまだないときは、調べている見出しだけを表示する',
  args: {
    status: 'running',
    queries: [],
  },
}

export const Interrupted: Story = {
  name: '中止した調査に未保存であることを示す',
  args: {
    status: 'interrupted',
  },
}

export const InterruptedWithPreservedSources: Story = {
  name: '共同編集で使われた資料を保持したことを示す',
  args: {
    status: 'interrupted',
    interruptedMessage:
      '調査を中断しました。共同編集の情報を守るため、関連する資料を保持しました。',
  },
}

export const ConnectionInterrupted: Story = {
  name: '接続中断の理由も表示する',
  args: {
    status: 'interrupted',
    error: '調査の接続が中断されました。',
  },
}

export const Cancelling: Story = {
  name: '調査の中止処理中であることを示す',
  args: {
    status: 'cancelling',
  },
}

export const Complete: Story = {
  name: '完了した調査は、検索語を隠して完了したことだけを示す',
  args: {
    status: 'complete',
  },
}
