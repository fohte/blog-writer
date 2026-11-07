import type { ReactNode } from 'react'

import { cn } from '#lib/utils'

export type ArticleExportSection = 'sync' | 'publish' | 'file'

type ArticleExportScreenProps = {
  articleTitle: string
  status?: ReactNode
  sections: Array<{
    value: ArticleExportSection
    label: string
    detail: string
  }>
  selected: ArticleExportSection
  onSelect: (section: ArticleExportSection) => void
  onBack: () => void
  children: ReactNode
}

export function ArticleExportScreen({
  articleTitle,
  status,
  sections,
  selected,
  onSelect,
  onBack,
  children,
}: ArticleExportScreenProps) {
  const selectedLabel = sections.find(({ value }) => value === selected)?.label

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex min-h-12 flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-4 py-2">
        <button
          className="text-sm text-muted-foreground-strong hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          ← 本文に戻る
        </button>
        <span className="min-w-0 flex-1 basis-60 truncate text-sm text-muted-foreground-strong">
          書き出し / {articleTitle}
        </span>
        {status}
      </header>
      <div className="mx-auto flex w-full max-w-300 flex-1 flex-col gap-8 px-6 py-8 lg:flex-row">
        <nav
          aria-label="書き出しの形"
          className="flex flex-col gap-2 lg:w-75 lg:shrink-0"
        >
          <span className="text-xs text-muted-foreground-strong">
            本文だけを書き出します。メモ・前提・資料は含みません。
          </span>
          {sections.map(({ value, label, detail }) => (
            <button
              aria-current={value === selected ? 'true' : undefined}
              className={cn(
                'flex flex-col gap-0.5 border p-3 text-left',
                value === selected
                  ? 'border-foreground bg-card'
                  : 'border-border hover:border-border-strong',
              )}
              key={value}
              onClick={() => {
                onSelect(value)
              }}
              type="button"
            >
              <span className="text-sm font-bold">{label}</span>
              <span className="font-mono text-xs text-muted-foreground-strong">
                {detail}
              </span>
            </button>
          ))}
        </nav>
        <main className="flex min-w-0 flex-1 flex-col gap-5">
          <h1 className="text-2xl font-bold">{selectedLabel}</h1>
          {children}
        </main>
      </div>
    </div>
  )
}
