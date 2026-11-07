export type {
  MarkdownEditorHandle,
  MarkdownEditorProps,
} from '#components/markdown-editor'
export { MarkdownEditor } from '#components/markdown-editor'
export { moveConflictExtension } from '#editor/move-conflict-extension'
export {
  createSuggestionLayer,
  type SuggestionDecision,
  type SuggestionLayerController,
  type SuggestionLayerError,
  type SuggestionLayerOptions,
  type SuggestionPosition,
  type TextSuggestion,
} from '#editor/suggestion-layer'
export {
  BodyRequestAccessory,
  type BodyRequestAccessoryContext,
  type BodyRequestEditorContext,
  bodyRequestExtensions,
} from '#proposals/body-request'
export {
  createOutlineProposalExtension,
  OutlineProposalAccessory,
  type OutlineProposalAccessoryContext,
  type OutlineProposalEditorContext,
  type OutlineProposalOptions,
  type OutlineProposalState,
  type OutlineSuggestion,
} from '#proposals/outline'
export { transitionProposalEditorExtensions } from '#proposals/transition'
