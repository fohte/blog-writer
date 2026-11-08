import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { setBody } from '#article/body'
import { deriveHeadingTree } from '#article/headings'
import { moveBlock } from '#article/move-block'
import {
  getMoveConflicts,
  observeMoveConflicts,
  resolveMoveConflict,
} from '#article/move-conflicts'
import { useMoveConflictCounts } from '#hooks/use-move-conflict-counts'

const initialBody = '## Ember\nu1\n## Brindle\nrho rho\n## Quartz\nv1\n'

let host: HTMLDivElement
let root: Root
let source: Y.Doc
let offline: Y.Doc
let stops: (() => void)[]

function Probe({ doc }: { doc: Y.Doc }) {
  const headings = deriveHeadingTree(doc.getText('body').toJSON())
  return <output>{JSON.stringify(useMoveConflictCounts(doc, headings))}</output>
}

function syncOfflineEdit() {
  Y.applyUpdate(
    source,
    Y.encodeStateAsUpdate(offline, Y.encodeStateVector(source)),
    'remote',
  )
}

const flush = () =>
  act(async () => {
    await Promise.resolve()
  })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  source = new Y.Doc()
  source.clientID = 71
  setBody(source, initialBody)
  offline = new Y.Doc()
  offline.clientID = 72
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(source))
  stops = [observeMoveConflicts(source), observeMoveConflicts(offline)]
  const text = offline.getText('body')
  text.insert(text.toJSON().indexOf('rho') + 3, 'xy')
  moveBlock(source, {
    from: initialBody.indexOf('## Brindle\n'),
    destination: initialBody.length,
  })._unsafeUnwrap()
  Y.applyUpdate(
    offline,
    Y.encodeStateAsUpdate(source, Y.encodeStateVector(offline)),
    'remote',
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
  for (const stop of stops) stop()
  source.destroy()
  offline.destroy()
  vi.unstubAllGlobals()
})

describe('useMoveConflictCounts', () => {
  it('counts a conflict that arrives after mounting and drops it once resolved', async () => {
    const outputs: Array<string | null | undefined> = []
    const render = () => {
      act(() => {
        root.render(<Probe doc={source} />)
      })
    }
    const read = () => host.querySelector('output')?.textContent

    render()
    await flush()
    outputs.push(read())

    syncOfflineEdit()
    await flush()
    render()
    outputs.push(read())

    const [conflict] = getMoveConflicts(source)
    resolveMoveConflict(source, conflict?.id ?? '', 'keep')._unsafeUnwrap()
    await flush()
    render()
    outputs.push(read())

    expect(outputs).toEqual(['{}', '{"0":1}', '{}'])
  })
})
