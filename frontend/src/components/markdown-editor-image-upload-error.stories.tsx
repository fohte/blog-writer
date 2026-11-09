import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  MarkdownEditorImageUploadError,
  type MarkdownEditorImageUploadErrorProps,
} from '#components/markdown-editor-image-upload-error'

const meta = {
  title: 'Editor/MarkdownEditorImageUploadError',
  component: MarkdownEditorImageUploadError,
} satisfies Meta<MarkdownEditorImageUploadErrorProps>

export default meta
type Story = StoryObj<typeof meta>

export const UploadFailed: Story = {
  name: 'the editor shows the message returned by a failed image upload.',
  args: { message: 'The image upload could not be completed. Try again.' },
}
