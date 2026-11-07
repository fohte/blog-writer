import type { Meta, StoryObj } from '@storybook/react-vite'

import { SourcePanelView } from '#components/source-panel-view'

const meta = {
  component: SourcePanelView,
  args: {
    sources: [],
    findings: [],
    evidence: [],
    pending: [],
    expandedSourceId: null,
    pasteTargetId: null,
    pastedBody: '',
    onAddUrl: () => true,
    onAddFile: () => {},
    onDrop: () => {},
    onDragOver: () => {},
    onPaste: () => {},
    onToggleSource: () => {},
    onDeleteSource: () => {},
    onPasteTarget: () => {},
    onPastedBodyChange: () => {},
    onSavePastedBody: () => {},
    onRetrySource: () => {},
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
    pasteTargetId: readySource.id,
    pastedBody: 'ここに資料本文を貼り付けます。',
  },
}

export const AnalysisFailed: Story = {
  name: '本文保存後に要約と要点の作成に失敗した資料を示す',
  args: {
    sources: [
      {
        ...readySource,
        status: 'analysisFailed',
        summary: '',
      },
    ],
    expandedSourceId: readySource.id,
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
  name: '要約のやり直しなどで取り込み直している既存資料は、行に取り込み中と表示する',
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

export const RecheckErrorDuringResearch: Story = {
  name: '別の調査を続けながら再判定できない理由を示す',
  args: {
    researchError: '別の調査が実行中のため、根拠を再判定できませんでした。',
    researchProgress: {
      status: 'running',
      queries: ['公開統計 2026'],
      target: '利用状況',
      onCancel: () => {},
    },
  },
}

export const WithEvidence: Story = {
  name: '資料ごとに、根拠にした文と要確認と確認後に編集した文の数を表示する',
  args: {
    sources: [
      readySource,
      {
        ...readySource,
        id: 'source-b',
        title: '利用者調査の報告',
        url: 'https://survey.example.invalid/2026',
        checkedAt: '2026-01-10T00:00:00.000Z',
      },
      {
        ...readySource,
        id: 'source-c',
        title: '会員向けの解説',
        url: 'https://members.example.invalid/guide',
        status: 'unavailable',
        summary: '',
      },
    ],
    evidence: [
      { sourceId: 'source-a', needsReview: false, edited: false },
      { sourceId: 'source-a', needsReview: true, edited: true },
      { sourceId: 'source-b', needsReview: false, edited: false },
    ],
    pending: [{ id: 'pending-a', label: 'data.example.invalid/2026' }],
    researchProgress: {
      status: 'running',
      queries: ['公開統計 2026'],
      target: '利用状況',
      onCancel: () => {},
    },
  },
}
