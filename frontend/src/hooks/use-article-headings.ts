import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'

import { deriveHeadingTree, getBody, readBody } from '#article/index'

export function useArticleHeadings(doc: Y.Doc) {
  const body = getBody(doc)
  const [markdown, setMarkdown] = useState(() => readBody(doc))
  const headings = useMemo(() => deriveHeadingTree(markdown), [markdown])

  useEffect(() => {
    const update = () => {
      setMarkdown(body.toJSON())
    }
    update()
    body.observe(update)
    return () => {
      body.unobserve(update)
    }
  }, [body])

  return { headings, markdown }
}
