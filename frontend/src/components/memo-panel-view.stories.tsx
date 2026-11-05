import type { Meta, StoryObj } from '@storybook/react-vite'

import { MemoPanelView } from '#components/memo-panel-view'

const meta = {
  component: MemoPanelView,
  args: {
    draft: '',
    onDraftChange: () => {},
    onAddMemo: () => {},
    onMoveMemo: () => {},
    onDismissMemo: () => {},
    onRestoreMemo: () => {},
  },
} satisfies Meta<typeof MemoPanelView>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  name: 'the memo panel has no saved notes',
  args: { memos: [] },
}

export const DraftReady: Story = {
  name: 'a draft is ready to add as a memo',
  args: {
    draft: '記事の導入を簡潔にする',
    memos: [],
  },
}

export const Unorganized: Story = {
  name: 'an unorganized memo can be dismissed',
  args: {
    memos: [
      {
        id: 'memo-a',
        text: '記事の導入を簡潔にする',
        order: 0,
        state: { kind: 'unorganized' },
      },
    ],
  },
}

export const Adopted: Story = {
  name: 'an adopted memo shows its heading',
  args: {
    memos: [
      {
        id: 'memo-a',
        text: '記事の導入を簡潔にする',
        order: 0,
        state: {
          kind: 'adopted',
          heading: {
            level: 2,
            text: '導入の構成',
            from: 0,
            to: 8,
            children: [],
          },
        },
      },
    ],
  },
}

export const Dismissed: Story = {
  name: 'a dismissed memo can return to unorganized',
  args: {
    memos: [
      {
        id: 'memo-a',
        text: '記事の導入を簡潔にする',
        order: 0,
        state: { kind: 'dismissed' },
      },
    ],
  },
}

export const OperationError: Story = {
  name: 'a memo action could not be saved',
  args: {
    error: 'メモを更新できませんでした。',
    memos: [],
  },
}
