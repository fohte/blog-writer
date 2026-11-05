import type { EditorView } from '@codemirror/view'
import type * as Y from 'yjs'

interface DiffTask {
  kind: 'diff'
  previousFrom: number
  previousTo: number
  nextFrom: number
  nextTo: number
}

interface EqualTask {
  kind: 'equal'
  length: number
}

interface EditTask {
  kind: 'edit'
  previousLength: number
  nextLength: number
}

type Task = DiffTask | EqualTask | EditTask

interface TextChange {
  from: number
  to: number
  insert: string
}

function tokenize(value: string): string[] {
  const characters: string[] = []

  for (const character of value) {
    characters.push(character)
  }

  return characters
}

function codeUnitLength(characters: string[], from: number, to: number) {
  let length = 0

  for (const character of characters.slice(from, to)) {
    length += character.length
  }

  return length
}

function findMiddleSplit(
  previous: string[],
  previousFrom: number,
  previousTo: number,
  next: string[],
  nextFrom: number,
  nextTo: number,
): { previous: number; next: number } | undefined {
  const previousLength = previousTo - previousFrom
  const nextLength = nextTo - nextFrom
  const maxDistance = Math.ceil((previousLength + nextLength) / 2)
  const offset = maxDistance + 1
  const vectorLength = 2 * maxDistance + 3
  const forward = new Int32Array(vectorLength).fill(-1)
  const reverse = new Int32Array(vectorLength).fill(-1)
  const delta = previousLength - nextLength
  const hasOddDelta = delta % 2 !== 0
  let forwardStart = 0
  let forwardEnd = 0
  let reverseStart = 0
  let reverseEnd = 0

  forward[offset + 1] = 0
  reverse[offset + 1] = 0

  const readVector = (vector: Int32Array, index: number) => vector[index] ?? -1

  for (let distance = 0; distance < maxDistance; distance += 1) {
    for (
      let diagonal = -distance + forwardStart;
      diagonal <= distance - forwardEnd;
      diagonal += 2
    ) {
      const vectorIndex = offset + diagonal
      let x =
        diagonal === -distance ||
        (diagonal !== distance &&
          readVector(forward, vectorIndex - 1) <
            readVector(forward, vectorIndex + 1))
          ? readVector(forward, vectorIndex + 1)
          : readVector(forward, vectorIndex - 1) + 1
      let y = x - diagonal

      while (
        x < previousLength &&
        y < nextLength &&
        previous[previousFrom + x] === next[nextFrom + y]
      ) {
        x += 1
        y += 1
      }

      forward[vectorIndex] = x

      if (x > previousLength) {
        forwardEnd += 2
      } else if (y > nextLength) {
        forwardStart += 2
      } else if (hasOddDelta) {
        const reverseIndex = offset + delta - diagonal
        if (
          reverseIndex >= 0 &&
          reverseIndex < vectorLength &&
          readVector(reverse, reverseIndex) !== -1
        ) {
          const reverseX = previousLength - readVector(reverse, reverseIndex)
          if (x >= reverseX) {
            return { previous: previousFrom + x, next: nextFrom + y }
          }
        }
      }
    }

    for (
      let diagonal = -distance + reverseStart;
      diagonal <= distance - reverseEnd;
      diagonal += 2
    ) {
      const vectorIndex = offset + diagonal
      let x =
        diagonal === -distance ||
        (diagonal !== distance &&
          readVector(reverse, vectorIndex - 1) <
            readVector(reverse, vectorIndex + 1))
          ? readVector(reverse, vectorIndex + 1)
          : readVector(reverse, vectorIndex - 1) + 1
      let y = x - diagonal

      while (
        x < previousLength &&
        y < nextLength &&
        previous[previousTo - x - 1] === next[nextTo - y - 1]
      ) {
        x += 1
        y += 1
      }

      reverse[vectorIndex] = x

      if (x > previousLength) {
        reverseEnd += 2
      } else if (y > nextLength) {
        reverseStart += 2
      } else if (!hasOddDelta) {
        const forwardIndex = offset + delta - diagonal
        if (
          forwardIndex >= 0 &&
          forwardIndex < vectorLength &&
          readVector(forward, forwardIndex) !== -1
        ) {
          const forwardX = readVector(forward, forwardIndex)
          const forwardY = forwardX - delta + diagonal
          const reverseX = previousLength - x
          if (forwardX >= reverseX) {
            return {
              previous: previousFrom + forwardX,
              next: nextFrom + forwardY,
            }
          }
        }
      }
    }
  }

  return undefined
}

function diff(previous: string, next: string): TextChange[] {
  const previousText = tokenize(previous)
  const nextText = tokenize(next)
  const changes: TextChange[] = []
  const tasks: Task[] = [
    {
      kind: 'diff',
      previousFrom: 0,
      previousTo: previousText.length,
      nextFrom: 0,
      nextTo: nextText.length,
    },
  ]
  let previousPosition = 0
  let nextPosition = 0
  let activeChange: { from: number; nextFrom: number } | undefined

  const flushChange = () => {
    if (!activeChange) return
    changes.push({
      from: activeChange.from,
      to: previousPosition,
      insert: next.slice(activeChange.nextFrom, nextPosition),
    })
    activeChange = undefined
  }

  const beginChange = () => {
    activeChange ??= { from: previousPosition, nextFrom: nextPosition }
  }

  while (tasks.length > 0) {
    const task = tasks.pop()
    if (!task) break

    if (task.kind === 'equal') {
      flushChange()
      previousPosition += task.length
      nextPosition += task.length
      continue
    }

    if (task.kind === 'edit') {
      beginChange()
      previousPosition += task.previousLength
      nextPosition += task.nextLength
      continue
    }

    let prefixLength = 0
    while (
      task.previousFrom + prefixLength < task.previousTo &&
      task.nextFrom + prefixLength < task.nextTo &&
      previousText[task.previousFrom + prefixLength] ===
        nextText[task.nextFrom + prefixLength]
    ) {
      prefixLength += 1
    }

    let suffixLength = 0
    while (
      suffixLength < task.previousTo - task.previousFrom - prefixLength &&
      suffixLength < task.nextTo - task.nextFrom - prefixLength &&
      previousText[task.previousTo - suffixLength - 1] ===
        nextText[task.nextTo - suffixLength - 1]
    ) {
      suffixLength += 1
    }

    const previousMiddleFrom = task.previousFrom + prefixLength
    const previousMiddleTo = task.previousTo - suffixLength
    const nextMiddleFrom = task.nextFrom + prefixLength
    const nextMiddleTo = task.nextTo - suffixLength
    const previousMiddleCharacterCount = previousMiddleTo - previousMiddleFrom
    const nextMiddleCharacterCount = nextMiddleTo - nextMiddleFrom
    const prefixCodeUnitLength = codeUnitLength(
      previousText,
      task.previousFrom,
      previousMiddleFrom,
    )
    const suffixCodeUnitLength = codeUnitLength(
      previousText,
      previousMiddleTo,
      task.previousTo,
    )

    if (suffixLength > 0) {
      tasks.push({ kind: 'equal', length: suffixCodeUnitLength })
    }

    if (previousMiddleCharacterCount === 0 || nextMiddleCharacterCount === 0) {
      if (previousMiddleCharacterCount > 0 || nextMiddleCharacterCount > 0) {
        tasks.push({
          kind: 'edit',
          previousLength: codeUnitLength(
            previousText,
            previousMiddleFrom,
            previousMiddleTo,
          ),
          nextLength: codeUnitLength(nextText, nextMiddleFrom, nextMiddleTo),
        })
      }
    } else {
      const split = findMiddleSplit(
        previousText,
        previousMiddleFrom,
        previousMiddleTo,
        nextText,
        nextMiddleFrom,
        nextMiddleTo,
      )

      if (
        split &&
        (split.previous !== previousMiddleFrom ||
          split.next !== nextMiddleFrom) &&
        (split.previous !== previousMiddleTo || split.next !== nextMiddleTo)
      ) {
        tasks.push({
          kind: 'diff',
          previousFrom: split.previous,
          previousTo: previousMiddleTo,
          nextFrom: split.next,
          nextTo: nextMiddleTo,
        })
        tasks.push({
          kind: 'diff',
          previousFrom: previousMiddleFrom,
          previousTo: split.previous,
          nextFrom: nextMiddleFrom,
          nextTo: split.next,
        })
      } else {
        tasks.push({
          kind: 'edit',
          previousLength: codeUnitLength(
            previousText,
            previousMiddleFrom,
            previousMiddleTo,
          ),
          nextLength: codeUnitLength(nextText, nextMiddleFrom, nextMiddleTo),
        })
      }
    }

    if (prefixLength > 0) {
      tasks.push({ kind: 'equal', length: prefixCodeUnitLength })
    }
  }

  flushChange()
  return changes
}

export function replaceBody(
  view: EditorView,
  undoManager: Y.UndoManager,
  next: string,
): void {
  const previous = view.state.doc.toString()
  if (previous === next) return

  const changes = diff(previous, next)
  if (changes.length === 0) return

  undoManager.stopCapturing()
  view.dispatch({ changes })
  undoManager.stopCapturing()
}
