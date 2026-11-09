import { GFM, parser } from '@lezer/markdown'

import { mdxMarkdownExtension } from '#markdown/mdx-markdown-extension'

export const markdownExtensions = [GFM, mdxMarkdownExtension] as const
export const markdownParser = parser.configure(markdownExtensions)
