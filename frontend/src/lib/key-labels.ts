const isApple = /Mac|iPhone|iPad/u.test(navigator.userAgent)

export const modLabel = isApple ? '⌘' : 'Ctrl+'
export const altLabel = isApple ? '⌥' : 'Alt+'
const shiftLabel = isApple ? '⇧' : 'Shift+'

export const writeMemoKeyLabel = `${modLabel}${shiftLabel}M`
export const outlineModeKeyLabel = `${modLabel}${shiftLabel}O`
