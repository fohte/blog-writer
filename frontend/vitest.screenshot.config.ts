import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createStorybookProject } from '@fohte/storybook-addon/vitest-plugin'
import { defineConfig, mergeConfig } from 'vitest/config'

import {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
} from './.storybook/screenshot-viewport'
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

export default mergeConfig(
  viteConfig,
  defineConfig({
<<<<<<< before updating
    ...storybookProject,
||||||| last update
  defineConfig(
    createStorybookProject({
      name: 'storybook-screenshot-frontend',
      rootDir: dirname,
      viewport: SCREENSHOT_VIEWPORT,
      screenshotsSubdir: 'desktop',
      setupFiles: ['./.storybook/vitest.setup.screenshot.ts'],
    }),
  ),
=======
>>>>>>> after updating
    test: {
<<<<<<< before updating
      ...storybookProject.test,
      browser: {
        ...storybookProject.test.browser,
        // Storybook capture uses CDP, which requires both browser API permissions.
        api: { allowWrite: true, allowExec: true },
      },
||||||| last update
  defineConfig(
    createStorybookProject({
      name: 'storybook-screenshot-frontend',
      rootDir: dirname,
      viewport: SCREENSHOT_VIEWPORT,
      screenshotsSubdir: 'desktop',
      setupFiles: ['./.storybook/vitest.setup.screenshot.ts'],
    }),
  ),
=======
      projects: [
        {
          extends: true,
          ...createStorybookProject({
            name: 'storybook-screenshot-frontend',
            rootDir: dirname,
            viewport: DESKTOP_VIEWPORT,
            screenshotsSubdir: 'desktop',
            setupFiles: ['./.storybook/vitest.setup.screenshot.ts'],
            excludeTags: ['mobile-only'],
          }),
        },
        {
          extends: true,
          ...createStorybookProject({
            name: 'storybook-screenshot-frontend-mobile',
            rootDir: dirname,
            viewport: MOBILE_VIEWPORT,
            screenshotsSubdir: 'mobile',
            setupFiles: ['./.storybook/vitest.setup.screenshot.ts'],
            excludeTags: ['desktop-only'],
          }),
        },
      ],
>>>>>>> after updating
    },
  }),
)
