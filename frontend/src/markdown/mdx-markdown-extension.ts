import type {
  BlockParser,
  InlineParser,
  MarkdownExtension,
} from '@lezer/markdown'

const componentTagPattern = /^<\/?[A-Z][A-Za-z0-9]*(?:\s+[^>]*)?\/?>[ \t]*$/u

const componentTagBlockParser: BlockParser = {
  name: 'MdxComponentTag',
  before: 'HTMLBlock',
  endLeaf(_context, line) {
    return componentTagPattern.test(line.text.slice(line.pos))
  },
  parse(context, line) {
    const source = line.text.slice(line.pos)
    if (!componentTagPattern.test(source)) return false

    const from = context.lineStart + line.pos
    const to = context.lineStart + line.text.length
    context.nextLine()
    context.addElement(context.elt('MdxComponentTag', from, to))
    return true
  },
}

const kbdInlineParser: InlineParser = {
  name: 'MdxKbd',
  before: 'HTMLTag',
  parse(context, next, position) {
    if (next !== 60) return -1

    const source = context.slice(position, context.end)
    const match = /^<Kbd>([^\r\n]*?)<\/Kbd>/u.exec(source)
    if (!match) return -1

    const contentFrom = position + '<Kbd>'.length
    const contentTo = contentFrom + (match[1]?.length ?? 0)
    const to = position + match[0].length
    return context.addElement(
      context.elt('MdxKbd', position, to, [
        context.elt('MdxKbdContent', contentFrom, contentTo),
      ]),
    )
  },
}

export const mdxMarkdownExtension: MarkdownExtension = {
  defineNodes: [
    { name: 'MdxComponentTag', block: true },
    'MdxKbd',
    'MdxKbdContent',
  ],
  parseBlock: [componentTagBlockParser],
  parseInline: [kbdInlineParser],
}
