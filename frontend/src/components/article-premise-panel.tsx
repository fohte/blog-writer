import { Textarea } from '@fohte/ui/textarea'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type * as Y from 'yjs'

import { getPremise, setPremise } from '#article/index'
import type { PremiseField } from '#article/types'

const premiseFields: Array<{ field: PremiseField; label: string }> = [
  { field: 'audience', label: '想定読者' },
  { field: 'purpose', label: '目的' },
  { field: 'claim', label: '主張' },
]

type ArticlePremisePanelProps = {
  doc: Y.Doc
  accessory?: ReactNode
}

export function ArticlePremisePanel({
  doc,
  accessory,
}: ArticlePremisePanelProps) {
  const [premise, setPremiseValue] = useState(() => getPremise(doc))

  useEffect(() => {
    const premiseMap = doc.getMap('premise')
    const refresh = () => {
      setPremiseValue(getPremise(doc))
    }
    premiseMap.observe(refresh)
    refresh()
    return () => {
      premiseMap.unobserve(refresh)
    }
  }, [doc])

  return (
    <div className="flex flex-col gap-4">
      {premiseFields.map(({ field, label }) => (
        <label
          className="flex flex-col gap-2"
          htmlFor={`premise-${field}`}
          key={field}
        >
          <span className="text-xs font-bold text-muted-foreground-strong">
            {label}
          </span>
          <Textarea
            id={`premise-${field}`}
            onChange={(event) => {
              const value = event.currentTarget.value
              setPremise(doc, field, value.length > 0 ? value : null)
              setPremiseValue(getPremise(doc))
            }}
            value={premise[field] ?? ''}
          />
        </label>
      ))}
      {accessory}
    </div>
  )
}
