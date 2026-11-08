import type { Meta, StoryObj } from '@storybook/react-vite'
import * as Y from 'yjs'

import { setBody } from '#article/body'
import { ArticleExportScreen } from '#components/article-export-screen'
import { ArticleFileSaveSection } from '#components/article-file-save-section'
import { ArticleFileSyncView } from '#components/article-file-sync-view'
import { ArticlePublishView } from '#components/article-publish-view'
import { SyncStatus } from '#components/sync-status'

const doc = new Y.Doc()
setBody(doc, 'A short article body.')

const allSections = [
  {
    value: 'sync',
    label: '本文ファイルへ自動同期',
    detail: '✓ 同期済み · notes/example.md',
  },
  {
    value: 'publish',
    label: '公開先へ PR',
    detail: '差分を確認してから PR を作成',
  },
  {
    value: 'file',
    label: 'ファイルに保存',
    detail: '.md / .mdx · frontmatter なし',
  },
] as const

const meta = {
  component: ArticleExportScreen,
  args: {
    articleTitle: '小さな記事の書き方',
    status: <SyncStatus state="synced" />,
    sections: [...allSections],
    selected: 'publish',
    onSelect: () => {},
    onBack: () => {},
    children: null,
  },
} satisfies Meta<typeof ArticleExportScreen>

export default meta
type Story = StoryObj<typeof meta>

export const PublishSelected: Story = {
  name: 'the screen shows the pull request form with the reviewed diff',
  args: {
    children: (
      <ArticlePublishView
        canPublish
        destinations={[
          {
            id: 'sample-site',
            repository: 'example/site',
            base_branch: 'main',
            path_template: 'posts/{slug}.mdx',
            format: 'mdx',
            frontmatter_template: 'title: {{ title }}',
          },
        ]}
        diff={{
          added: 2,
          removed: 2,
          fetchedAt: Date.UTC(2026, 0, 15, 7, 16),
          original: 'title: "小さな記事"\n\n古い本文',
          modified: 'title: "小さな記事の書き方"\n\n新しい本文',
        }}
        frontmatter={'title: "小さな記事の書き方"\ndate: "2026-01-15"'}
        onDestinationChange={() => {}}
        onFrontmatterChange={() => {}}
        onPublish={() => {}}
        onShowDiff={() => {}}
        onSlugChange={() => {}}
        selectedDestinationId="sample-site"
        slug="small-article"
      />
    ),
  },
}

export const SyncSelected: Story = {
  name: 'the screen shows the file sync form for a file changed outside the app',
  args: {
    sections: [
      {
        ...allSections[0],
        detail: '! 外部で変更あり · notes/example.md',
      },
      allSections[1],
      allSections[2],
    ],
    selected: 'sync',
    children: (
      <ArticleFileSyncView
        body={'# 小さな記事\n\nアプリで書き直した段落です。'}
        content={'# 小さな記事\n\nファイル側で書き直した段落です。'}
        contentHash="sample-hash"
        onImport={() => {}}
        onOverwrite={() => {}}
        onPathChange={() => {}}
        onSetPath={() => {}}
        path="notes/example.md"
        status="external_changed"
      />
    ),
  },
}

export const FileSaveOnly: Story = {
  name: 'only saving to a file is offered when sync and publishing are disabled',
  args: {
    sections: [allSections[2]],
    selected: 'file',
    children: (
      <ArticleFileSaveSection
        articleId="sample-article"
        articleTitle="小さな記事の書き方"
        doc={doc}
      />
    ),
  },
}
