import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createStorybookProject } from '@fohte/storybook-addon/vitest-plugin'
import { defineConfig, mergeConfig } from 'vitest/config'

import { SCREENSHOT_VIEWPORT } from './.storybook/screenshot-viewport'
import viteConfig from './vite.config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// A separate config file rather than a project entry in vitest.config.ts:
// the `storybook` project (check runs) and this one both point at
// .storybook/, and driving that configDir from two projects in the same
// process causes Storybook's dev-server cache to collide.
export default mergeConfig(
  viteConfig,
  defineConfig(
    createStorybookProject({
      name: 'storybook-screenshot-frontend',
      rootDir: dirname,
      viewport: SCREENSHOT_VIEWPORT,
      screenshotsSubdir: 'desktop',
      setupFiles: ['./.storybook/vitest.setup.screenshot.ts'],
    }),
  ),
)
