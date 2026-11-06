import type * as Y from 'yjs'

import { getPremise } from '#article/index'
import { topLevelBlocks } from '#article/move-block-structure'
import type { components } from '#lib/api/schema.gen.d.ts'
import type { LlmSettings } from '#lib/llm-settings'

export type OutlineProposalRequest =
  components['schemas']['OutlineProposalRequest']
export type OutlineProposalResponse =
  components['schemas']['OutlineProposalResponse']
type ProposalBlockRange = Pick<
  OutlineProposalRequest['blocks'][number],
  'deletion_from' | 'from' | 'kind' | 'to'
>

export function requestUrl(settings: LlmSettings): string {
  if (settings.route === 'server') return '/api/proposals/outline'
  return `${settings.bridgeUrl.replace(/\/+$/, '')}/api/proposals/outline`
}

export function requestBody(
  doc: Y.Doc,
  markdown: string,
): OutlineProposalRequest {
  const premise = getPremise(doc)
  const blocks = topLevelBlocks(markdown)
  return {
    premise: {
      audience: premise.audience ?? '',
      purpose: premise.purpose ?? '',
      thesis: premise.claim ?? '',
    },
    body_length: markdown.length,
    blocks: blocks.map((block, index) => {
      const kind = /^ATXHeading[1-6]$/u.test(block.name)
        ? 'heading'
        : block.name === 'Paragraph'
          ? 'paragraph'
          : block.name.toLowerCase()
      const base = {
        id: `article-block-${String(index + 1)}`,
        kind,
        markdown: markdown.slice(block.from, block.contentTo),
        from: block.from,
        to: block.contentTo,
      }
      const deleteFrom =
        kind === 'heading' ? deletionFrom(markdown, blocks, index) : block.from
      return deleteFrom === block.from
        ? base
        : { ...base, deletion_from: deleteFrom }
    }),
  }
}

function deletionFrom(
  markdown: string,
  blocks: ReturnType<typeof topLevelBlocks>,
  blockIndex: number,
): number {
  const block = blocks[blockIndex]
  const previous = blocks[blockIndex - 1]
  if (!block) return 0
  if (blockIndex !== blocks.length - 1 || !previous) return block.from

  const separator = markdown.slice(previous.contentTo, block.from)
  const firstLineEnding = /\r\n|\r|\n/u.exec(separator)
  if (!firstLineEnding) return block.from
  const remainingSeparator = separator.slice(
    firstLineEnding.index + firstLineEnding[0].length,
  )
  if (!/\r\n|\r|\n/u.test(remainingSeparator)) return block.from

  // Keep the previous block's line ending while removing the empty line before
  // a tail heading.
  return previous.contentTo + firstLineEnding.index + firstLineEnding[0].length
}

export function suggestionTargetRange(
  suggestion: OutlineProposalResponse['suggestions'][number],
  blocks: readonly ProposalBlockRange[],
  blockIndex: number,
  bodyLength: number,
): { from: number; to: number } | null {
  const block = blocks[blockIndex]
  if (!block) return null

  if (suggestion.replacement === '') {
    if (block.kind !== 'heading') return null
    return {
      from: block.deletion_from ?? block.from,
      to: blocks[blockIndex + 1]?.from ?? bodyLength,
    }
  }
  if (suggestion.from === suggestion.to) {
    return block.kind === 'paragraph'
      ? { from: block.from, to: block.from }
      : null
  }
  return block.kind === 'heading' ? { from: block.from, to: block.to } : null
}

export function isOutlineProposalResponse(
  value: unknown,
): value is OutlineProposalResponse {
  if (typeof value !== 'object' || value === null) return false
  const suggestions = (value as { suggestions?: unknown }).suggestions
  return (
    Array.isArray(suggestions) &&
    suggestions.every(
      (suggestion: unknown) =>
        typeof suggestion === 'object' &&
        suggestion !== null &&
        Number.isInteger((suggestion as { from?: unknown }).from) &&
        Number.isInteger((suggestion as { to?: unknown }).to) &&
        typeof (suggestion as { replacement?: unknown }).replacement ===
          'string',
    )
  )
}
