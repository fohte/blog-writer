import { Kbd } from '@fohte/ui/kbd'
import type { ReactNode } from 'react'

import { altLabel, modLabel, outlineModeKeyLabel } from '#lib/key-labels'

type KeyHint = { keys: ReactNode; description: string }

const addHint: KeyHint = { keys: <Kbd>⏎</Kbd>, description: '下に見出しを足す' }
const levelHint: KeyHint = {
  keys: (
    <>
      <Kbd>Tab</Kbd>
      <Kbd>⇧Tab</Kbd>
    </>
  ),
  description: '階層を下げる / 上げる',
}
const moveHint: KeyHint = {
  keys: (
    <>
      <Kbd>{altLabel}↑</Kbd>
      <Kbd>{altLabel}↓</Kbd>
    </>
  ),
  description: '配下ごと移動',
}

const columnHints: KeyHint[] = [
  {
    keys: <Kbd>{modLabel}1</Kbd>,
    description: '構成欄へ (Esc で本文へ戻る)',
  },
  {
    keys: (
      <>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
      </>
    ),
    description: '見出しを選ぶ。そのまま打てば書き換え',
  },
  addHint,
  levelHint,
  moveHint,
  {
    keys: <Kbd>{modLabel}⌫</Kbd>,
    description: '見出しを消す (段落は上の見出しに残る)',
  },
  { keys: <Kbd>{outlineModeKeyLabel}</Kbd>, description: '構成モードで書く' },
]

const writingHints: KeyHint[] = [
  addHint,
  levelHint,
  moveHint,
  {
    keys: <Kbd>⌫</Kbd>,
    description: '空の行で押すと見出しを消す (段落は上の見出しに残る)',
  },
  {
    keys: <Kbd>{modLabel}⏎</Kbd>,
    description: '本文に切り替えてその見出しの下へ',
  },
  { keys: <Kbd>{outlineModeKeyLabel}</Kbd>, description: '本文へ' },
]

export function OutlineKeyHints({ writing = false }: { writing?: boolean }) {
  return (
    <dl className="flex flex-col gap-1 px-2 text-xs text-muted-foreground pointer-coarse:hidden">
      {(writing ? writingHints : columnHints).map(({ keys, description }) => (
        <div className="flex gap-3" key={description}>
          <dt className="flex w-20 shrink-0 items-start gap-1">{keys}</dt>
          <dd>{description}</dd>
        </div>
      ))}
    </dl>
  )
}
