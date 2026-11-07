import { Button } from '@fohte/ui/button'
import type { ReactNode } from 'react'

type ArticleBodyProps = {
  title: string
  loading: boolean
  empty: boolean
  children?: ReactNode
  onTitleChange: (title: string) => void
  onWriteMemo: () => void
  onDecidePremise: () => void
}

const skeletonLineWidths = ['w-3/5', 'w-full', 'w-11/12', 'w-4/5', 'w-2/3']

export function ArticleBody({
  title,
  loading,
  empty,
  children,
  onTitleChange,
  onWriteMemo,
  onDecidePremise,
}: ArticleBodyProps) {
  return (
    <article className="mx-auto flex w-full max-w-175 flex-col gap-4">
      <input
        aria-label="タイトル"
        className="w-full bg-transparent text-3xl leading-snug font-bold outline-none placeholder:text-muted-foreground"
        onChange={(event) => {
          onTitleChange(event.currentTarget.value)
        }}
        placeholder="タイトル"
        value={title}
      />
      {loading ? (
        <div aria-busy="true" className="flex flex-col gap-3" role="status">
          <span className="sr-only">記事を開いています</span>
          {skeletonLineWidths.map((width) => (
            <span
              aria-hidden="true"
              className={`block h-4 bg-muted ${width}`}
              key={width}
            />
          ))}
        </div>
      ) : null}
      {empty ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-sm leading-relaxed text-muted-foreground-strong">
            まずはメモに思いつくことを書き出すか、そのまま本文を書き始めます。
          </p>
          <div className="flex gap-2">
            <Button
              onClick={onWriteMemo}
              size="sm"
              type="button"
              variant="outline"
            >
              メモを書く
            </Button>
            <Button
              onClick={onDecidePremise}
              size="sm"
              type="button"
              variant="outline"
            >
              前提を決める
            </Button>
          </div>
        </div>
      ) : null}
      {children}
    </article>
  )
}
