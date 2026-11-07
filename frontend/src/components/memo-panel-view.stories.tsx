import type { Meta, StoryObj } from '@storybook/react-vite'

import { MemoPanelView } from '#components/memo-panel-view'

const headings = [
  {
    level: 1,
    text: 'Overview',
    from: 0,
    to: 11,
    children: [{ level: 2, text: 'Goals', from: 13, to: 21, children: [] }],
  },
  { level: 1, text: 'Details', from: 23, to: 33, children: [] },
]

const mixedMemos = [
  {
    id: 'memo-a',
    text: '記事の導入を簡潔にする',
    order: 0,
    state: { kind: 'unorganized' as const },
  },
  {
    id: 'memo-b',
    text: '背景にある課題を説明する',
    order: 1,
    state: {
      kind: 'adopted' as const,
      heading: { level: 2, text: '課題の背景', from: 10, to: 18, children: [] },
    },
  },
  {
    id: 'memo-c',
    text: '補足資料を追加する',
    order: 2,
    state: { kind: 'dismissed' as const },
  },
  {
    id: 'memo-d',
    text: '読者がつまずきやすい手順を先に示す',
    order: 3,
    state: { kind: 'unorganized' as const },
  },
]

const meta = {
  component: MemoPanelView,
  args: {
    draft: '',
    filter: 'unorganized',
    headings: [],
    onDraftChange: () => {},
    onAddMemo: () => {},
    onFilterChange: () => {},
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
  name: 'the unorganized memos each show a button to adopt them.',
  args: { headings, memos: mixedMemos },
}

export const AdoptionMenuOpen: Story = {
  name: 'the adoption menu offers existing and new heading targets',
  args: { headings, memos: mixedMemos, openAdoptionMenuId: 'memo-a' },
}

export const Adopted: Story = {
  name: 'an adopted memo shows its heading',
  args: { filter: 'adopted', memos: mixedMemos },
}

export const Dismissed: Story = {
  name: 'a dismissed memo can return to unorganized',
  args: { filter: 'dismissed', memos: mixedMemos },
}

export const NoAdoptedMemos: Story = {
  name: 'the adopted filter explains that no memo has been adopted yet.',
  args: {
    filter: 'adopted',
    memos: mixedMemos.filter((memo) => memo.state.kind !== 'adopted'),
  },
}

export const OperationError: Story = {
  name: 'a memo action could not be saved',
  args: {
    error: 'メモを更新できませんでした。',
    memos: [],
  },
}
