import { EditorSelection } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'

import {
  cleanupHistoryEditors,
  createHistoryEditor,
  step,
} from '#outline/move-history.test-support.test'

afterEach(cleanupHistoryEditors)

describe('MoveHistory move selections', () => {
  it('keeps the cursor in moved paragraphs and heading sections on undo and redo', () => {
    const paragraph = `# A

first para

second

third
`
    const section = `# A

first para

# B

second

# C

third
`
    const cases = [
      {
        kind: 'paragraph',
        initial: paragraph,
        movedText: 'first para',
        from: paragraph.indexOf('first para'),
        destination: paragraph.indexOf('third'),
      },
      {
        kind: 'section',
        initial: section,
        movedText: 'second',
        from: section.indexOf('# B'),
        destination: section.length,
      },
    ]
    const actual = cases.map(
      ({ kind, initial, movedText, from, destination }) => {
        const editor = createHistoryEditor(initial)
        const originalCursor = initial.indexOf(movedText) + 2
        editor.view.dispatch({
          selection: EditorSelection.cursor(originalCursor),
        })
        const move = editor.history.move({ from, destination }, editor.view)
        const afterMove = editor.body.toJSON()
        const cursorAfterMove = editor.view.state.selection.main.head
        const undo = step(editor, 'undo')
        const afterUndo = editor.body.toJSON()
        const cursorAfterUndo = editor.view.state.selection.main.head
        const redo = step(editor, 'redo')
        const afterRedo = editor.body.toJSON()
        const cursorAfterRedo = editor.view.state.selection.main.head

        return {
          kind,
          moveSucceeded: move.isOk(),
          afterMove,
          cursorAfterMove,
          undo,
          afterUndo,
          cursorAfterUndo,
          redo,
          afterRedo,
          cursorAfterRedo,
        }
      },
    )

    expect(actual).toEqual([
      {
        kind: 'paragraph',
        moveSucceeded: true,
        afterMove: `# A

second

first para

third
`,
        cursorAfterMove:
          `# A

second

first para

third
`.indexOf('first para') + 2,
        undo: true,
        afterUndo: paragraph,
        cursorAfterUndo: paragraph.indexOf('first para') + 2,
        redo: true,
        afterRedo: `# A

second

first para

third
`,
        cursorAfterRedo:
          `# A

second

first para

third
`.indexOf('first para') + 2,
      },
      {
        kind: 'section',
        moveSucceeded: true,
        afterMove: `# A

first para

# C

third

# B

second
`,
        cursorAfterMove:
          `# A

first para

# C

third

# B

second
`.indexOf('second') + 2,
        undo: true,
        afterUndo: section,
        cursorAfterUndo: section.indexOf('second') + 2,
        redo: true,
        afterRedo: `# A

first para

# C

third

# B

second
`,
        cursorAfterRedo:
          `# A

first para

# C

third

# B

second
`.indexOf('second') + 2,
      },
    ])
  })
})
