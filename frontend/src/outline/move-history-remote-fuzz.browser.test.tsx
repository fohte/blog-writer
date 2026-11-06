import { Transaction } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { topLevelBlocks } from '#article/index'
import { observeMoveConflicts } from '#article/move-conflicts'
import {
  cleanupHistoryEditors,
  createHistoryEditor,
  edit,
  isSafeUtf16Boundary,
  seededRandom,
  seededRandomIndex,
  syncDocs,
} from '#outline/move-history.test-support.test'

afterEach(cleanupHistoryEditors)

describe('MoveHistory remote seeded sequences', () => {
  it('preserves remote text across seeded local undo and redo sequences', () => {
    const initial =
      'Opening paragraph.\n\n# Saffron\n\nsaffron-para: seed\n\nsaffron-shared: stable\n\n# Glacier\n\nglacier-para: seed\n\n# Meadow\n\nmeadow-para: seed\n'
    const seeds = Array.from({ length: 24 }, (_, index) => index + 1)
    const operationCount = 32
    const remoteText = (markdown: string, seed: number) =>
      markdown
        .replace('Opening paragraph.', `Shared opening note ${String(seed)}.`)
        .replace(
          'saffron-shared: stable',
          `saffron-shared: Peer ${String(seed)} stable`,
        )
    const actual = seeds.map((seed) => {
      const nextRandom = seededRandom(seed)
      const editor = createHistoryEditor(initial)
      const paragraphMarkers = [
        'saffron-para:',
        'glacier-para:',
        'meadow-para:',
      ]
      const headingMarkers = ['# Saffron', '# Glacier', '# Meadow']
      const errors: string[] = []

      for (let index = 0; index < operationCount; index += 1) {
        const markdown = editor.body.toJSON()
        const operation = nextRandom() % 5
        if (operation < 2) {
          const marker =
            paragraphMarkers[nextRandom() % paragraphMarkers.length]
          if (marker === undefined) {
            errors.push('paragraph marker was missing')
            continue
          }
          const markerFrom = markdown.indexOf(marker)
          const position = markerFrom + marker.length + 1
          if (operation === 0) {
            edit(editor, position, position, 'x', 'input.type', index * 1_000)
          } else {
            const character = markdown[position]
            if (character !== undefined && character !== '\n') {
              edit(
                editor,
                position,
                position + 1,
                '',
                'delete.selection',
                index * 1_000,
              )
            }
          }
        } else if (operation === 2) {
          const marker = headingMarkers[nextRandom() % headingMarkers.length]
          if (marker === undefined) {
            errors.push('heading marker was missing')
            continue
          }
          const titleEnd = markdown.indexOf(marker) + marker.length
          edit(editor, titleEnd, titleEnd, 'x', 'input.type', index * 1_000)
        } else {
          const marker = headingMarkers[nextRandom() % headingMarkers.length]
          if (marker === undefined) {
            errors.push('heading marker was missing')
            continue
          }
          const from = markdown.indexOf(marker)
          const headingPositions = headingMarkers
            .map((candidate) => markdown.indexOf(candidate))
            .filter((position) => position >= 0)
            .sort((left, right) => left - right)
          const nextHeading = headingPositions.find(
            (position) => position > from,
          )
          const destinations = headingPositions.filter(
            (position) => position !== from && position !== nextHeading,
          )
          if (nextHeading !== undefined) destinations.push(markdown.length)
          const destination =
            destinations[nextRandom() % destinations.length] ?? markdown.length
          const result = editor.history.move({ from, destination }, editor.view)
          if (result.isErr()) errors.push(result.error.message)
        }
      }

      const beforeRemote = editor.body.toJSON()
      const openingParagraph = beforeRemote.indexOf('Opening paragraph.')
      const sharedParagraph = beforeRemote.indexOf('saffron-shared: stable')
      if (openingParagraph === -1 || sharedParagraph === -1) {
        errors.push('opening paragraph was missing')
      } else {
        editor.doc.transact(() => {
          editor.body.delete(
            openingParagraph,
            openingParagraph + 'Opening paragraph'.length,
          )
          editor.body.insert(
            openingParagraph,
            `Shared opening note ${String(seed)}`,
          )
          const updatedSharedParagraph = editor.body
            .toJSON()
            .indexOf('saffron-shared: stable')
          editor.body.insert(
            updatedSharedParagraph + 'saffron-shared: '.length,
            `Peer ${String(seed)} `,
          )
        }, 'remote')
      }

      let undoCount = 0
      for (let stepIndex = 0; stepIndex < 100; stepIndex += 1) {
        const result = editor.history.undo(editor.view)
        if (result.isErr()) {
          errors.push(result.error.message)
          continue
        }
        if (!result.value) break
        undoCount += 1
      }
      const afterUndo = editor.body.toJSON()
      let redoCount = 0
      for (let stepIndex = 0; stepIndex < 100; stepIndex += 1) {
        const result = editor.history.redo(editor.view)
        if (result.isErr()) {
          errors.push(result.error.message)
          continue
        }
        if (!result.value) break
        redoCount += 1
      }

      const afterRedo = editor.body.toJSON()
      return {
        seed,
        errors,
        undoRestored: afterUndo === remoteText(initial, seed),
        redoRestored: afterRedo === remoteText(beforeRemote, seed),
        redoCountMatchesUndo: redoCount === undoCount,
      }
    })

    expect(actual).toEqual(
      seeds.map((seed) => ({
        seed,
        errors: [],
        undoRestored: true,
        redoRestored: true,
        redoCountMatchesUndo: true,
      })),
    )
  })

  it('keeps CodeMirror and Yjs aligned for seeded emoji moves and remote edits', () => {
    const initial =
      '# A\n\naaa aaa\n\n## A1\n\na1 a1\n\n# B\n\nbbb 😀 bbb\n\npara two\n\n# C\n\nccc\n'
    const seeds = [3386, 3668]
    const actual = seeds.map((seed) => {
      const random = seededRandomIndex(seed * 9_973)
      const isSafeBoundary = isSafeUtf16Boundary
      const splitBoundaries: { event: string; from: number; to: number }[] = []
      const editor = createHistoryEditor(initial, (update) => {
        for (const transaction of update.transactions) {
          const event = transaction.annotation(Transaction.userEvent)
          if (event !== 'undo' && event !== 'redo') continue
          const before = transaction.startState.doc.toString()
          transaction.changes.iterChangedRanges((from, to) => {
            if (!isSafeBoundary(before, from) || !isSafeBoundary(before, to)) {
              splitBoundaries.push({ event, from, to })
            }
          })
        }
      })
      const peer = new Y.Doc()
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.doc))
      const stopEditorObserving = observeMoveConflicts(editor.doc)
      const stopPeerObserving = observeMoveConflicts(peer)
      const peerBody = peer.getText('body')
      const sync = () => {
        syncDocs(editor.doc, peer)
      }
      const characters = ['x', 'yy', '\n', '\n\n', '# H\n', '😀', ' ', '## ']
      let remoteCount = 0
      const insertedRemoteTokens: string[] = []
      const syncMismatches: {
        operation: number
        body: string
        editor: string
      }[] = []
      const remote = () => {
        const text = peerBody.toJSON()
        const position = random(text.length + 1)
        if (!isSafeBoundary(text, position)) return
        const character = String.fromCharCode(0xe000 + remoteCount)
        peer.transact(() => {
          peerBody.insert(position, character)
        })
        insertedRemoteTokens.push(character)
        remoteCount += 1
        sync()
      }
      const local = (operation: number) => {
        const text = editor.body.toJSON()
        const kind = random(10)
        if (kind < 3) {
          const position = random(text.length + 1)
          if (!isSafeBoundary(text, position)) return
          const value = characters[random(characters.length)]
          if (value === undefined) return
          edit(
            editor,
            position,
            position,
            value,
            value.length === 0 ? 'delete.selection' : 'input.type',
            operation * 1_000 + 1_000,
          )
          return
        }
        if (kind < 5 && text.length > 0) {
          const from = random(text.length)
          const to = Math.min(from + 1 + random(12), text.length)
          if (!isSafeBoundary(text, from) || !isSafeBoundary(text, to)) return
          edit(
            editor,
            from,
            to,
            '',
            'delete.selection',
            operation * 1_000 + 1_000,
          )
          return
        }
        if (kind < 6 && text.length > 0) {
          const from = random(text.length)
          const to = Math.min(from + 1 + random(6), text.length)
          if (!isSafeBoundary(text, from) || !isSafeBoundary(text, to)) return
          const value = characters[random(characters.length)]
          if (value === undefined || text.slice(from, to) === value) return
          edit(
            editor,
            from,
            to,
            value,
            'input.replace',
            operation * 1_000 + 1_000,
          )
          return
        }
        const blocks = topLevelBlocks(text)
        if (blocks.length < 2) return
        const source = blocks[random(blocks.length)]
        const target = blocks[random(blocks.length)]
        if (!source || !target) return
        const destination = random(4) ? target.from : text.length
        editor.history.move({ from: source.from, destination }, editor.view)
      }

      for (let operation = 0; operation < 12; operation += 1) {
        if (random(3) === 0) remote()
        else local(operation)
        if (editor.view.state.doc.toString() !== editor.body.toJSON()) {
          syncMismatches.push({
            operation,
            body: editor.body.toJSON(),
            editor: editor.view.state.doc.toString(),
          })
        }
      }

      const remoteTokens = insertedRemoteTokens.filter((token) =>
        editor.body.toJSON().includes(token),
      )
      const remoteTextLosses: { direction: string; token: string }[] = []
      const checkRemoteText = (direction: 'undo' | 'redo') => {
        for (const token of remoteTokens) {
          if (
            !editor.body.toJSON().includes(token) &&
            !remoteTextLosses.some(
              (loss) => loss.direction === direction && loss.token === token,
            )
          ) {
            remoteTextLosses.push({ direction, token })
          }
        }
      }
      const errors: { direction: string; error: string }[] = []
      const mismatches: { direction: string; body: string; editor: string }[] =
        []
      let remoteTokensLostAfterUndo: string[] = []
      for (const direction of ['undo', 'redo'] as const) {
        for (let count = 0; count < 80; count += 1) {
          const result = editor.history[direction](editor.view)
          if (result.isErr()) {
            errors.push({ direction, error: result.error.message })
            checkRemoteText(direction)
            continue
          }
          if (!result.value) break
          checkRemoteText(direction)
          if (editor.view.state.doc.toString() !== editor.body.toJSON()) {
            mismatches.push({
              direction,
              body: editor.body.toJSON(),
              editor: editor.view.state.doc.toString(),
            })
            break
          }
        }
        if (direction === 'undo') {
          const afterUndo = editor.body.toJSON()
          remoteTokensLostAfterUndo = insertedRemoteTokens.filter(
            (token) => !afterUndo.includes(token),
          )
        }
      }
      sync()
      const output = {
        seed,
        errors,
        mismatches,
        remoteTextLosses,
        remoteTokensLostAfterUndo,
        syncMismatches,
        splitBoundaries,
        converged: peerBody.toJSON() === editor.body.toJSON(),
      }
      stopEditorObserving()
      stopPeerObserving()
      editor.view.destroy()
      editor.history.destroy()
      editor.doc.destroy()
      editor.host.remove()
      peer.destroy()
      return output
    })

    expect(actual).toEqual(
      seeds.map((seed) => ({
        seed,
        errors: [],
        mismatches: [],
        remoteTextLosses: [],
        remoteTokensLostAfterUndo: [],
        syncMismatches: [],
        splitBoundaries: [],
        converged: true,
      })),
    )
  })
})
