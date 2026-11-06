import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { topLevelBlocks } from '#article/index'
import {
  cleanupHistoryEditors,
  createHistoryEditor,
  edit,
  isSafeUtf16Boundary,
  seededRandomIndex,
  syncDocs,
} from '#outline/move-history.test-support.test'

afterEach(cleanupHistoryEditors)

describe('MoveHistory mixed seeded sequences', () => {
  it('maps remote edits at multiple history stages without losing their text', () => {
    const initial = `# A

alpha 😀 alpha

# B

beta paragraph

    indented code

# C

third paragraph
`
    const seeds = Array.from({ length: 12 }, (_, index) => index + 1)
    const actual = seeds.map((seed) => {
      const random = seededRandomIndex(seed)
      const editor = createHistoryEditor(initial)
      const peer = new Y.Doc()
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.doc))
      const peerBody = peer.getText('body')
      const sync = () => {
        syncDocs(editor.doc, peer)
      }
      const remoteTokens: string[] = []
      const foundTokens = (text: string) =>
        remoteTokens.filter((token) => text.indexOf(token) >= 0)
      const remoteInsert = (position: number, label: string) => {
        const token = `R${String(seed)}${label}`
        remoteTokens.push(token)
        peer.transact(() => {
          peerBody.insert(position, token)
        })
        sync()
        return token
      }

      const alphaEnd = initial.indexOf('alpha') + 'alpha'.length
      edit(editor, alphaEnd, alphaEnd, ' local', 'input.type', 10_000)
      const afterEdit = editor.body.toJSON()
      const move = editor.history.move(
        {
          from: afterEdit.indexOf('# B'),
          destination: afterEdit.indexOf('# A'),
        },
        editor.view,
      )
      const afterMove = editor.body.toJSON()
      const firstRemotePosition =
        initial.indexOf('alpha') + random('alpha'.length + 1)
      const firstToken = remoteInsert(firstRemotePosition, 'a')
      const afterFirstRemote = editor.body.toJSON()
      const undoMove = editor.history.undo(editor.view)
      const afterUndo = editor.body.toJSON()
      sync()
      const tokensAfterUndoSync = foundTokens(editor.body.toJSON())
      const peerTokensAfterUndoSync = foundTokens(peerBody.toJSON())
      const matchesAfterUndoSync = peerBody.toJSON() === editor.body.toJSON()
      const secondRemotePosition =
        afterUndo.indexOf('local') + random('local'.length + 1)
      const secondToken = remoteInsert(secondRemotePosition, 'b')
      const afterSecondRemote = editor.body.toJSON()
      const redoMove = editor.history.redo(editor.view)
      const afterRedo = editor.body.toJSON()
      sync()
      const seamPosition = afterRedo.indexOf('# C')
      const seamToken = remoteInsert(seamPosition, 'c')
      const beforeFailedUndo = editor.body.toJSON()
      const failedUndo = editor.history.undo(editor.view).match(
        () => null,
        (error) => error.message,
      )
      const afterFailedUndo = editor.body.toJSON()
      const nextUndo = editor.history.undo(editor.view).match(
        (value) => value,
        () => false,
      )
      const nextRedo = editor.history.redo(editor.view).match(
        (value) => value,
        () => false,
      )
      const output = {
        seed,
        afterEdit,
        moveSucceeded: move.isOk(),
        afterMove,
        firstToken,
        tokensAfterFirstRemote: foundTokens(afterFirstRemote),
        undoMove: undoMove.match(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error: error.message }),
        ),
        tokensAfterUndo: foundTokens(afterUndo),
        tokensAfterUndoSync,
        peerTokensAfterUndoSync,
        matchesAfterUndoSync,
        secondToken,
        tokensAfterSecondRemote: foundTokens(afterSecondRemote),
        redoMove: redoMove.match(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error: error.message }),
        ),
        tokensAfterRedo: foundTokens(afterRedo),
        seamToken,
        foundTokensBeforeFailedUndo: foundTokens(beforeFailedUndo),
        failedUndo,
        foundTokensAfterFailedUndo: foundTokens(afterFailedUndo),
        stateUnchangedByFailedUndo: afterFailedUndo === beforeFailedUndo,
        nextUndo,
        nextRedo,
        peerMatches: peerBody.toJSON() === editor.body.toJSON(),
        editorMatches:
          editor.view.state.doc.toString() === editor.body.toJSON(),
      }
      peer.destroy()
      editor.view.destroy()
      editor.history.destroy()
      editor.doc.destroy()
      editor.host.remove()
      return output
    })

    expect(actual).toEqual(
      seeds.map((seed) => ({
        seed,
        afterEdit: `# A

alpha local 😀 alpha

# B

beta paragraph

    indented code

# C

third paragraph
`,
        moveSucceeded: true,
        afterMove: `# B

beta paragraph

    indented code

# A

alpha local 😀 alpha

# C

third paragraph
`,
        firstToken: `R${String(seed)}a`,
        tokensAfterFirstRemote: [`R${String(seed)}a`],
        undoMove: { ok: true, value: true },
        tokensAfterUndo: [`R${String(seed)}a`],
        tokensAfterUndoSync: [`R${String(seed)}a`],
        peerTokensAfterUndoSync: [`R${String(seed)}a`],
        matchesAfterUndoSync: true,
        secondToken: `R${String(seed)}b`,
        tokensAfterSecondRemote: [`R${String(seed)}a`, `R${String(seed)}b`],
        redoMove: { ok: true, value: true },
        tokensAfterRedo: [`R${String(seed)}a`, `R${String(seed)}b`],
        seamToken: `R${String(seed)}c`,
        foundTokensBeforeFailedUndo: [
          `R${String(seed)}a`,
          `R${String(seed)}b`,
          `R${String(seed)}c`,
        ],
        failedUndo: 'A remote change overlaps a moved block boundary',
        foundTokensAfterFailedUndo: [
          `R${String(seed)}a`,
          `R${String(seed)}b`,
          `R${String(seed)}c`,
        ],
        stateUnchangedByFailedUndo: true,
        nextUndo: false,
        nextRedo: false,
        peerMatches: true,
        editorMatches: true,
      })),
    )
  })

  it('restores seeded paragraph edits and moves exactly through undo and redo', () => {
    const initial = `# A

alpha 😀 alpha

## A1

child paragraph

# B

beta paragraph

    indented code

# C

last paragraph
`
    const seeds = Array.from({ length: 24 }, (_, index) => index + 1)
    const operationCount = 40
    const actual = seeds.map((seed) => {
      const random = seededRandomIndex(seed)
      const safeBoundary = isSafeUtf16Boundary
      const editor = createHistoryEditor(initial)
      const insertions = [
        'x',
        'yy',
        '\n',
        '\n\n',
        `# H

`,
        '😀',
        ' ',
      ]
      const undoStates = [initial]
      const redoStates: string[] = []
      const errors: { operation: number; message: string }[] = []
      const mismatches: {
        operation: number
        expected: string
        body: string
        editor: string
      }[] = []
      let expectedCurrent = initial
      let expectedLatest = initial

      const recordEdit = (before: string) => {
        const after = editor.body.toJSON()
        if (after === before) return
        undoStates.push(expectedCurrent)
        expectedCurrent = after
        expectedLatest = after
        redoStates.length = 0
      }

      for (let operation = 0; operation < operationCount; operation += 1) {
        const before = editor.body.toJSON()
        const choice = random(8)
        if (choice < 3) {
          const from = random(before.length + 1)
          const value = insertions[random(insertions.length)]
          if (value !== undefined && safeBoundary(before, from)) {
            edit(
              editor,
              from,
              from,
              value,
              'input.type',
              (operation + 1) * 1_000,
            )
            recordEdit(before)
          }
        } else if (choice < 5 && before.length > 0) {
          const from = random(before.length)
          const to = Math.min(from + 1 + random(14), before.length)
          if (safeBoundary(before, from) && safeBoundary(before, to)) {
            edit(
              editor,
              from,
              to,
              '',
              'delete.selection',
              (operation + 1) * 1_000,
            )
            recordEdit(before)
          }
        } else if (choice === 5) {
          const from = random(before.length + 1)
          if (safeBoundary(before, from)) {
            edit(
              editor,
              from,
              from,
              '\n\n',
              'input.type',
              (operation + 1) * 1_000,
            )
            recordEdit(before)
          }
        } else if (choice === 6) {
          const blocks = topLevelBlocks(before)
          const paragraphs = blocks.filter(
            (block) =>
              !before.slice(block.from, block.contentTo).startsWith('#'),
          )
          const source = paragraphs[random(paragraphs.length)]
          const target = paragraphs[random(paragraphs.length)]
          if (source && target && source.from !== target.from) {
            const move = editor.history.move(
              { from: source.from, destination: target.from },
              editor.view,
            )
            const after = editor.body.toJSON()
            if (move.isOk() && after !== before) {
              undoStates.push(expectedCurrent)
              expectedCurrent = after
              expectedLatest = after
              redoStates.length = 0
            }
          }
        } else if (random(2) === 0) {
          const result = editor.history.undo(editor.view)
          if (undoStates.length > 1) {
            const expected = undoStates.pop()
            redoStates.push(expectedCurrent)
            if (result.isErr())
              errors.push({ operation, message: result.error.message })
            else if (!result.value)
              errors.push({ operation, message: 'undo returned false' })
            else if (expected !== undefined) expectedCurrent = expected
          } else if (result.isErr() || result.value) {
            errors.push({
              operation,
              message: 'undo found an unexpected action',
            })
          }
        } else {
          const result = editor.history.redo(editor.view)
          if (redoStates.length > 0) {
            const expected = redoStates.pop()
            undoStates.push(expectedCurrent)
            if (result.isErr())
              errors.push({ operation, message: result.error.message })
            else if (!result.value)
              errors.push({ operation, message: 'redo returned false' })
            else if (expected !== undefined) expectedCurrent = expected
          } else if (result.isErr() || result.value) {
            errors.push({
              operation,
              message: 'redo found an unexpected action',
            })
          }
        }

        const body = editor.body.toJSON()
        const editorText = editor.view.state.doc.toString()
        if (body !== expectedCurrent || editorText !== expectedCurrent) {
          mismatches.push({
            operation,
            expected: expectedCurrent,
            body,
            editor: editorText,
          })
        }
      }

      for (let count = 0; count < operationCount; count += 1) {
        if (undoStates.length <= 1) break
        const expected = undoStates.pop()
        redoStates.push(expectedCurrent)
        const result = editor.history.undo(editor.view)
        if (result.isErr())
          errors.push({
            operation: operationCount,
            message: result.error.message,
          })
        else if (!result.value)
          errors.push({
            operation: operationCount,
            message: 'undo returned false',
          })
        else if (expected !== undefined) expectedCurrent = expected
        if (editor.body.toJSON() !== expectedCurrent) {
          mismatches.push({
            operation: operationCount,
            expected: expectedCurrent,
            body: editor.body.toJSON(),
            editor: editor.view.state.doc.toString(),
          })
        }
      }
      const afterUndo = editor.body.toJSON()
      for (let count = 0; count < operationCount; count += 1) {
        if (redoStates.length === 0) break
        const expected = redoStates.pop()
        undoStates.push(expectedCurrent)
        const result = editor.history.redo(editor.view)
        if (result.isErr())
          errors.push({
            operation: operationCount + 1,
            message: result.error.message,
          })
        else if (!result.value)
          errors.push({
            operation: operationCount + 1,
            message: 'redo returned false',
          })
        else if (expected !== undefined) expectedCurrent = expected
        if (editor.body.toJSON() !== expectedCurrent) {
          mismatches.push({
            operation: operationCount + 1,
            expected: expectedCurrent,
            body: editor.body.toJSON(),
            editor: editor.view.state.doc.toString(),
          })
        }
      }
      const output = {
        seed,
        errors,
        mismatches,
        undoRestoredStart: afterUndo === initial,
        redoRestoredLatest: editor.body.toJSON() === expectedLatest,
      }
      editor.view.destroy()
      editor.history.destroy()
      editor.doc.destroy()
      editor.host.remove()
      return output
    })

    expect(actual).toEqual(
      seeds.map((seed) => ({
        seed,
        errors: [],
        mismatches: [],
        undoRestoredStart: true,
        redoRestoredLatest: true,
      })),
    )
  })
})
