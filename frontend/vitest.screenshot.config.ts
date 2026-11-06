import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createStorybookProject } from '@fohte/storybook-addon/vitest-plugin'
import { defineConfig, mergeConfig } from 'vitest/config'

import { SCREENSHOT_VIEWPORT } from './.storybook/screenshot-viewport'
import viteConfig from './vite.config'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const screenshotViewport =
  process.env['VRT_VIEWPORT'] === 'tablet'
    ? { width: 900, height: 800 }
    : SCREENSHOT_VIEWPORT
const storybookProject = createStorybookProject({
  name: 'storybook-screenshot-frontend',
  rootDir: dirname,
  viewport: screenshotViewport,
  screenshotsSubdir: 'desktop',
  setupFiles: ['./.storybook/vitest.setup.screenshot.ts'],
})

// A separate config file rather than a project entry in vitest.config.ts:
// the `storybook` project (check runs) and this one both point at
// .storybook/, and driving that configDir from two projects in the same
// process causes Storybook's dev-server cache to collide.
export default mergeConfig(
  viteConfig,
  defineConfig({
    ...storybookProject,
    test: {
      ...storybookProject.test,
      browser: {
        ...storybookProject.test.browser,
        // Storybook capture uses CDP, which requires both browser API permissions.
        api: { allowWrite: true, allowExec: true },
      },
    },
  }),
)
