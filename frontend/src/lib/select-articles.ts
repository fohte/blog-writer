import type { Article } from '#lib/sync-client'

export type ArticleSortOrder = 'edited' | 'created'

const lastEditedAt = ({ updatedAt, createdAt }: Article) =>
  updatedAt ?? createdAt

export function selectArticles(
  articles: Article[],
  query: string,
  sortOrder: ArticleSortOrder,
  readBody: (id: string) => string,
): Article[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  // shortcut: every keystroke re-reads each article body, cache them per document if typing lags on a large collection.
  const matches =
    normalizedQuery === ''
      ? articles
      : articles.filter(
          ({ id, title }) =>
            title.toLocaleLowerCase().includes(normalizedQuery) ||
            readBody(id).toLocaleLowerCase().includes(normalizedQuery),
        )
  return matches.toSorted(
    sortOrder === 'created'
      ? (a, b) => a.createdAt - b.createdAt
      : (a, b) => lastEditedAt(b) - lastEditedAt(a),
  )
}
