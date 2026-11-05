import * as Y from 'yjs'

import type { Premise, PremiseField } from '#article/types'

function getPremiseMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('premise')
}

export function getPremise(doc: Y.Doc): Premise {
  const premise = getPremiseMap(doc)
  const value = (field: PremiseField): string | null => {
    const fieldValue = premise.get(field)
    return typeof fieldValue === 'string' ? fieldValue : null
  }

  return {
    audience: value('audience'),
    purpose: value('purpose'),
    claim: value('claim'),
  }
}

export function setPremise(
  doc: Y.Doc,
  field: PremiseField,
  value: string | null,
): void {
  const premise = getPremiseMap(doc)
  if (value === null) premise.delete(field)
  else premise.set(field, value)
}
