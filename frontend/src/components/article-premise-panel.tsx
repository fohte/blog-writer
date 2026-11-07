import { useEffect, useState } from 'react'
import type * as Y from 'yjs'

import { getPremise, setPremise } from '#article/index'
import {
  type PremiseDiscussion,
  PremisePanelView,
} from '#components/premise-panel-view'

type ArticlePremisePanelProps = {
  doc: Y.Doc
  discussion?: PremiseDiscussion | undefined
}

export function ArticlePremisePanel({
  doc,
  discussion,
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
    <PremisePanelView
      discussion={discussion}
      onValueChange={(field, value) => {
        setPremise(doc, field, value.length > 0 ? value : null)
        setPremiseValue(getPremise(doc))
      }}
      values={{
        audience: premise.audience ?? '',
        purpose: premise.purpose ?? '',
        claim: premise.claim ?? '',
      }}
    />
  )
}
