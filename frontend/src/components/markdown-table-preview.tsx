export type TableAlignment = 'left' | 'center' | 'right' | null

export interface MarkdownTablePreviewProps {
  alignment: TableAlignment[]
  header: string[]
  rows: string[][]
}

function alignmentClass(alignment: TableAlignment): string {
  if (alignment === 'center') return 'text-center'
  if (alignment === 'right') return 'text-right'
  return 'text-left'
}

export function createMarkdownTablePreview({
  alignment,
  header,
  rows,
}: MarkdownTablePreviewProps): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'overflow-x-auto rounded-md border'
  const table = document.createElement('table')
  table.className = 'w-full border-collapse text-sm'
  const thead = document.createElement('thead')
  thead.className = 'bg-muted/50'
  const headerRow = document.createElement('tr')

  header.forEach((cell, index) => {
    const element = document.createElement('th')
    element.className = `border-b px-3 py-2 font-medium ${alignmentClass(alignment[index] ?? null)}`
    element.scope = 'col'
    element.textContent = cell
    headerRow.append(element)
  })
  thead.append(headerRow)

  const tbody = document.createElement('tbody')
  rows.forEach((row) => {
    const rowElement = document.createElement('tr')
    header.forEach((_, columnIndex) => {
      const cell = document.createElement('td')
      cell.className = `border-b px-3 py-2 ${alignmentClass(alignment[columnIndex] ?? null)}`
      cell.textContent = row[columnIndex] ?? ''
      rowElement.append(cell)
    })
    tbody.append(rowElement)
  })

  table.append(thead, tbody)
  wrapper.append(table)
  return wrapper
}

export function MarkdownTablePreview({
  alignment,
  header,
  rows,
}: MarkdownTablePreviewProps) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/50">
          <tr>
            {header.map((cell, index) => (
              <th
                className={`border-b px-3 py-2 font-medium ${alignmentClass(alignment[index] ?? null)}`}
                key={index}
                scope="col"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr className="last:[&>td]:border-b-0" key={rowIndex}>
              {header.map((_, columnIndex) => (
                <td
                  className={`border-b px-3 py-2 ${alignmentClass(alignment[columnIndex] ?? null)}`}
                  key={columnIndex}
                >
                  {row[columnIndex] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
