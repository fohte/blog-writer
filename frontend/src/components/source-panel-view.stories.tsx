import type { Meta, StoryObj } from '@storybook/react-vite'

import { SourcePanelView } from '#components/source-panel-view'

const meta = {
  component: SourcePanelView,
  args: {
    sources: [],
    findings: [],
    pending: [],
    expandedSourceId: null,
    pasteTargetId: null,
    pastedBody: '',
    onDrop: () => {},
    onDragOver: () => {},
    onPaste: () => {},
    onToggleSource: () => {},
    onDeleteSource: () => {},
    onPasteTarget: () => {},
    onPastedBodyChange: () => {},
    onSavePastedBody: () => {},
  },
} satisfies Meta<typeof SourcePanelView>

export default meta
type Story = StoryObj<typeof meta>

const readySource = {
  id: 'source-a',
  kind: 'url',
  title: '公開統計の概要',
  url: 'https://data.example.invalid/report',
  fileName: null,
  checkedAt: '2026-01-14T00:00:00.000Z',
  status: 'ready',
  summary: '調査結果の概要を説明しています。',
} as const

const firstFinding = {
  id: 'finding-a',
  sourceId: 'source-a',
  text: '利用者数は前年より増加しました。',
  quote: '利用者数は前年より 12% 増加しました。',
} as const

export const Empty: Story = {
  name: '資料がまだ登録されていない',
}

export const Importing: Story = {
  name: '資料の取り込み中に進捗を表示する',
  args: {
    pending: [{ id: 'pending-a', label: 'data.example.invalid' }],
  },
}

export const Unavailable: Story = {
  name: '取得できない資料に本文貼り付けを案内する',
  args: {
    sources: [
      {
        ...readySource,
        status: 'unavailable',
        summary: '',
      },
    ],
    expandedSourceId: readySource.id,
    pasteTargetId: readySource.id,
    pastedBody: 'ここに資料本文を貼り付けます。',
  },
}

export const Ready: Story = {
  name: '取得済み資料を一覧に表示する',
  args: {
    sources: [readySource],
  },
}

export const Expanded: Story = {
  name: '資料を開くと要約と要点を表示する',
  args: {
    sources: [readySource],
    findings: [firstFinding],
    expandedSourceId: readySource.id,
  },
}

export const ImportingExisting: Story = {
  name: '本文の要点を作成中は資料の削除を無効にする',
  args: {
    sources: [readySource],
    pending: [{ id: readySource.id, label: readySource.title }],
  },
}

export const FindingCard: Story = {
  name: '要点の資料カードに引用と要約を表示する',
  args: {
    sources: [readySource],
    findings: [firstFinding],
    expandedSourceId: readySource.id,
    openFindingId: firstFinding.id,
  },
}

export const Error: Story = {
  name: '資料を登録できない理由を表示する',
  args: {
    error: '資料ページを取得できませんでした。',
  },
}
