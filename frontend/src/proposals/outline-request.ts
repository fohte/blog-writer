import type * as Y from 'yjs'

import { getPremise } from '#article/index'
import { topLevelBlocks } from '#article/move-block-structure'
import type { components } from '#lib/api/schema.gen.d.ts'
import type { LlmSettings } from '#lib/llm-settings'

export type OutlineProposalRequest =
  components['schemas']['OutlineProposalRequest']
export type OutlineProposalResponse =
  components['schemas']['OutlineProposalResponse']

export function requestUrl(settings: LlmSettings): string {
  if (settings.route === 'server') return '/api/proposals/outline'
  return `${settings.bridgeUrl.replace(/\/+$/, '')}/api/proposals/outline`
}

export function requestBody(
  doc: Y.Doc,
  markdown: string,
): OutlineProposalRequest {
  const premise = getPremise(doc)
  return {
    premise: {
      audience: premise.audience ?? '',
      purpose: premise.purpose ?? '',
      thesis: premise.claim ?? '',
    },
    body_length: markdown.length,
    blocks: topLevelBlocks(markdown).map((block, index) => ({
      id: `article-block-${String(index + 1)}`,
      kind: /^ATXHeading[1-6]$/u.test(block.name)
        ? 'heading'
        : block.name === 'Paragraph'
          ? 'paragraph'
          : block.name.toLowerCase(),
      markdown: markdown.slice(block.from, block.contentTo),
      from: block.from,
      to: block.contentTo,
    })),
  }
}

export function suggestionTargetTo(
  block: { to: number },
  replacement: string,
  bodyLength: number,
): number {
  // Deleting a heading includes its following newline when one exists.
  return replacement === '' && block.to < bodyLength ? block.to + 1 : block.to
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
