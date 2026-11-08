import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { Result } from 'neverthrow'
import type { ReactNode } from 'react'
import type * as Y from 'yjs'

import type { ArticleExportSection } from '#components/article-export-screen'
import type { SyncState } from '#lib/sync-client'
import type { MoveHistory } from '#outline/index'
import type { OutlineWriting } from '#outline/use-outline-keyboard'

export type ArticleEditorPanel =
  'memo' | 'outline' | 'body' | 'premise' | 'sources'
type ArticleEditorLayout = 'responsive' | 'mobile' | 'desktop'
export type ArticleEditorContext = {
  articleId: string
  doc: Y.Doc
  history: MoveHistory
  view: EditorView | null
  replaceBody: (value: string) => Result<void, EditorNotReadyError>
  showSources: () => void
  openExport: (section?: ArticleExportSection) => void
}
export type ArticleExportContext = ArticleEditorContext & {
  section: ArticleExportSection | undefined
  syncStatus: SyncState | undefined
  onBack: () => void
}
type ArticleOutlineRenderContext = ArticleEditorContext & {
  mobile: boolean
  onHeadingSelected: () => void
  writing: OutlineWriting | undefined
}

export class EditorNotReadyError extends Error {
  constructor() {
    super('The article editor is not ready')
    this.name = 'EditorNotReadyError'
  }
}

export interface ArticleEditorViewProps {
  articleId: string
  title: string
  doc?: Y.Doc | undefined
  status?: { kind: 'loading' } | { kind: 'error'; message: string } | undefined
  layout?: ArticleEditorLayout
  initialPanel?: ArticleEditorPanel
  initialOutlineMode?: boolean
  /** Keeps extension instances stable by calling the factory once per article document. */
  editorExtensions?:
    ((context: { doc: Y.Doc; history: MoveHistory }) => Extension[]) | undefined
  bodyAccessory?: ((context: ArticleEditorContext) => ReactNode) | undefined
  /** Opens the body request from the mobile toolbar; the toolbar hides the request button without it. */
  onRequest?: ((context: ArticleEditorContext) => void) | undefined
  outlineRenderer?:
    ((context: ArticleOutlineRenderContext) => ReactNode) | undefined
  premisePanel?: ((context: ArticleEditorContext) => ReactNode) | undefined
  /** Renders above every panel so the writer notices it whichever panel is open. */
  articleNotice?: ((context: ArticleEditorContext) => ReactNode) | undefined
  exportScreen?: ((context: ArticleExportContext) => ReactNode) | undefined
  sourcesPanel?:
    ReactNode | ((context: ArticleEditorContext) => ReactNode) | undefined
  onViewChange?: ((view: EditorView | null) => void) | undefined
  syncStatus?: SyncState | undefined
  syncedAt?: number | undefined
  syncError?: string | undefined
  requiresAuthentication?: boolean | undefined
  onLoginAgain?: (() => void) | undefined
  onTitleChange: (title: string) => void
  onBack: () => void
  onOpenSettings: () => void
}

export type ArticleEditorIntegrationProps = Pick<
  ArticleEditorViewProps,
  | 'bodyAccessory'
  | 'editorExtensions'
  | 'exportScreen'
  | 'articleNotice'
  | 'onRequest'
  | 'onViewChange'
  | 'outlineRenderer'
  | 'premisePanel'
  | 'sourcesPanel'
>
