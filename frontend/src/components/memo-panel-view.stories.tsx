import type { Meta, StoryObj } from '@storybook/react-vite'

import { MemoPanelView } from '#components/memo-panel-view'

const meta = {
  component: MemoPanelView,
  args: {
    draft: '',
    headings: [],
    onDraftChange: () => {},
    onAddMemo: () => {},
    onMoveMemo: () => {},
    onDismissMemo: () => {},
    onRestoreMemo: () => {},
    onAdoptToHeading: () => {},
    onInsertAsHeading: () => {},
    onOpenAdoptionMenuChange: () => {},
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
    headings: [
      { level: 1, text: 'Overview', from: 0, to: 11, children: [] },
      { level: 1, text: 'Details', from: 13, to: 23, children: [] },
    ],
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

export const AdoptionMenuOpen: Story = {
  name: 'the adoption menu offers existing and new heading targets',
  args: {
    headings: [
      {
        level: 1,
        text: 'Overview',
        from: 0,
        to: 11,
        children: [{ level: 2, text: 'Goals', from: 13, to: 21, children: [] }],
      },
      { level: 1, text: 'Details', from: 23, to: 33, children: [] },
    ],
    memos: [
      {
        id: 'memo-a',
        text: '記事の導入を簡潔にする',
        order: 0,
        state: { kind: 'unorganized' },
      },
    ],
    openAdoptionMenuId: 'memo-a',
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

export const MixedMemoStates: Story = {
  name: 'unorganized, adopted, and dismissed memos are listed together',
  args: {
    memos: [
      {
        id: 'memo-a',
        text: '記事の導入を簡潔にする',
        order: 0,
        state: { kind: 'unorganized' },
      },
      {
        id: 'memo-b',
        text: '背景にある課題を説明する',
        order: 1,
        state: {
          kind: 'adopted',
          heading: {
            level: 2,
            text: '課題の背景',
            from: 10,
            to: 18,
            children: [],
          },
        },
      },
      {
        id: 'memo-c',
        text: '補足資料を追加する',
        order: 2,
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
