const isApple = /Mac|iPhone|iPad/u.test(navigator.userAgent)

export const modLabel = isApple ? '⌘' : 'Ctrl+'
export const altLabel = isApple ? '⌥' : 'Alt+'
export const writeMemoKeyLabel = `${modLabel}${isApple ? '⇧' : 'Shift+'}M`
