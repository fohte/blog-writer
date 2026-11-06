import { afterEach, describe, expect, it } from 'vitest'

import {
  cleanupHistoryEditors,
  createHistoryEditor,
  edit,
} from '#outline/move-history.test-support.test'

afterEach(cleanupHistoryEditors)

describe('MoveHistory local seeded sequences', () => {
  it('preserves mixed move undo and redo sequences across seeded runs', () => {
    const initial =
      '# Saffron\n\nseed-a\n\n# Glacier\n\nseed-b\n\n# Meadow\n\nseed-c\n'
    const seeds = Array.from({ length: 32 }, (_, index) => index + 1)
    const operationCount = 48
    const actual = seeds.map((seed) => {
      let randomState = seed
      const nextRandom = () => {
        randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0
        return randomState
      }
      const editor = createHistoryEditor(initial)
      const headings = ['# Saffron', '# Glacier', '# Meadow']
      const undoStates: string[] = []
      const redoStates: string[] = []
      const errors: string[] = []
      const mismatches: {
        operation: number
        expected: string
        actual: string
      }[] = []
      let expectedCurrent = initial
      let expectedLatest = initial

      const compareCurrent = (operation: number) => {
        const current = editor.body.toJSON()
        if (current !== expectedCurrent) {
          mismatches.push({
            operation,
            expected: expectedCurrent,
            actual: current,
          })
        }
      }

      for (let operation = 0; operation < operationCount; operation += 1) {
        const choice = nextRandom() % 4
        if (choice < 2) {
          const markdown = editor.body.toJSON()
          const source = headings[nextRandom() % headings.length]
          if (source === undefined) {
            errors.push('heading seed was missing')
            continue
          }
          const from = markdown.indexOf(source)
          const destination = from === 0 ? markdown.length : 0
          const result = editor.history.move({ from, destination }, editor.view)
          if (result.isErr()) {
            errors.push(result.error.message)
          } else {
            undoStates.push(expectedCurrent)
            expectedCurrent = editor.body.toJSON()
            expectedLatest = expectedCurrent
            redoStates.length = 0
          }
        } else if (choice === 2) {
          const result = editor.history.undo(editor.view)
          if (undoStates.length > 0) {
            const expected = undoStates.pop()
            redoStates.push(expectedCurrent)
            if (result.isErr()) errors.push(result.error.message)
            else if (!result.value) errors.push('undo returned false')
            else if (expected !== undefined) expectedCurrent = expected
          } else if (result.isErr() || result.value) {
            errors.push('undo found an unexpected action')
          }
        } else {
          const result = editor.history.redo(editor.view)
          if (redoStates.length > 0) {
            const expected = redoStates.pop()
            undoStates.push(expectedCurrent)
            if (result.isErr()) errors.push(result.error.message)
            else if (!result.value) errors.push('redo returned false')
            else if (expected !== undefined) expectedCurrent = expected
          } else if (result.isErr() || result.value) {
            errors.push('redo found an unexpected action')
          }
        }
        compareCurrent(operation)
      }
      while (undoStates.length > 0) {
        redoStates.push(expectedCurrent)
        const expected = undoStates.pop()
        const result = editor.history.undo(editor.view)
        if (result.isErr()) errors.push(result.error.message)
        else if (!result.value) errors.push('undo returned false')
        else if (expected !== undefined) expectedCurrent = expected
        compareCurrent(operationCount)
      }
      const afterUndo = editor.body.toJSON()
      while (redoStates.length > 0) {
        const expected = redoStates.pop()
        undoStates.push(expectedCurrent)
        const result = editor.history.redo(editor.view)
        if (result.isErr()) errors.push(result.error.message)
        else if (!result.value) errors.push('redo returned false')
        else if (expected !== undefined) expectedCurrent = expected
        compareCurrent(operationCount + 1)
      }
      const afterRedo = editor.body.toJSON()
      return {
        seed,
        errors,
        mismatches,
        restoredStart: afterUndo === initial,
        restoredFinal: afterRedo === expectedLatest,
      }
    })

    expect(actual).toEqual(
      seeds.map((seed) => ({
        seed,
        errors: [],
        mismatches: [],
        restoredStart: true,
        restoredFinal: true,
      })),
    )
  })

  it('keeps seeded text and move undo and redo states exact', () => {
    const initial =
      '# Saffron\n\nsaffron-para: seed\n\n# Glacier\n\nglacier-para: seed\n\n# Meadow\n\nmeadow-para: seed\n'
    const seeds = Array.from({ length: 64 }, (_, index) => index + 1)
    const operationCount = 48
    const actual = seeds.map((seed) => {
      let randomState = seed
      const nextRandom = () => {
        randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0
        return randomState
      }
      const editor = createHistoryEditor(initial)
      const editMarkers = ['saffron-para:', 'glacier-para:', 'meadow-para:']
      const headings = ['# Saffron', '# Glacier', '# Meadow']
      const errors: string[] = []
      const mismatches: {
        operation: number
        expected: string
        actual: string
      }[] = []
      const undoStates: string[] = []
      const redoStates: string[] = []
      let expectedCurrent = initial
      let expectedLatest = initial
      let verificationStep = 0

      const compareCurrent = (operation: number) => {
        const current = editor.body.toJSON()
        if (current !== expectedCurrent) {
          mismatches.push({
            operation,
            expected: expectedCurrent,
            actual: current,
          })
        }
      }

      const recordNewAction = (before: string) => {
        const after = editor.body.toJSON()
        if (after === before) return
        undoStates.push(before)
        expectedCurrent = after
        expectedLatest = after
        redoStates.length = 0
      }

      for (let index = 0; index < operationCount; index += 1) {
        const markdown = editor.body.toJSON()
        const operation = nextRandom() % 7
        const editTime = (index + 1) * 1_000
        if (operation < 3) {
          const marker = editMarkers[nextRandom() % editMarkers.length]
          if (marker === undefined) {
            errors.push('paragraph marker was missing')
            continue
          }
          const markerFrom = markdown.indexOf(marker)
          const position = markerFrom + marker.length + 1
          if (operation === 0) {
            edit(editor, position, position, 'x', 'input.type', editTime)
          } else if (operation === 1) {
            const character = markdown[position]
            if (character !== undefined && character !== '\n') {
              edit(
                editor,
                position,
                position + 1,
                '',
                'delete.selection',
                editTime,
              )
            } else {
              edit(editor, position, position, 'x', 'input.type', editTime)
            }
          } else {
            edit(editor, position, position, '\n', 'input.type', editTime)
          }
          recordNewAction(markdown)
        } else if (operation === 3) {
          const heading = headings[nextRandom() % headings.length]
          if (heading === undefined) {
            errors.push('heading seed was missing')
            continue
          }
          const titleEnd = markdown.indexOf(heading) + heading.length
          edit(editor, titleEnd, titleEnd, 'x', 'input.type', editTime)
          recordNewAction(markdown)
        } else if (operation === 4) {
          const fromHeading = headings[nextRandom() % headings.length]
          if (fromHeading === undefined) {
            errors.push('heading seed was missing')
            continue
          }
          const from = markdown.indexOf(fromHeading)
          const destination = from === 0 ? markdown.length : 0
          const result = editor.history.move({ from, destination }, editor.view)
          if (result.isErr()) errors.push(result.error.message)
          else recordNewAction(markdown)
        } else if (operation === 5) {
          const result = editor.history.undo(editor.view)
          if (undoStates.length === 0) {
            if (result.isErr() || result.value)
              errors.push('undo found an unexpected action')
          } else {
            const expected = undoStates.pop()
            if (result.isErr()) errors.push(result.error.message)
            else if (!result.value) errors.push('undo returned false')
            else {
              redoStates.push(expectedCurrent)
              if (expected !== undefined) expectedCurrent = expected
            }
          }
        } else {
          const result = editor.history.redo(editor.view)
          if (redoStates.length === 0) {
            if (result.isErr() || result.value)
              errors.push('redo found an unexpected action')
          } else {
            const expected = redoStates.pop()
            if (result.isErr()) errors.push(result.error.message)
            else if (!result.value) errors.push('redo returned false')
            else {
              undoStates.push(expectedCurrent)
              if (expected !== undefined) expectedCurrent = expected
            }
          }
        }
        compareCurrent(verificationStep)
        verificationStep += 1
      }

      while (undoStates.length > 0) {
        const expected = undoStates.pop()
        const result = editor.history.undo(editor.view)
        if (result.isErr()) errors.push(result.error.message)
        else if (!result.value) errors.push('undo returned false')
        else {
          redoStates.push(expectedCurrent)
          if (expected !== undefined) expectedCurrent = expected
        }
        compareCurrent(verificationStep)
        verificationStep += 1
      }
      const afterUndo = editor.body.toJSON()
      while (redoStates.length > 0) {
        const expected = redoStates.pop()
        const result = editor.history.redo(editor.view)
        if (result.isErr()) errors.push(result.error.message)
        else if (!result.value) errors.push('redo returned false')
        else {
          undoStates.push(expectedCurrent)
          if (expected !== undefined) expectedCurrent = expected
        }
        compareCurrent(verificationStep)
        verificationStep += 1
      }
      const afterRedo = editor.body.toJSON()
      return {
        seed,
        errors,
        mismatches,
        undoRestoredStart: afterUndo === initial,
        redoRestoredLatest: afterRedo === expectedLatest,
      }
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
