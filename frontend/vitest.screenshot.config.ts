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
const desktopViewport =
  process.env['VRT_VIEWPORT'] === 'tablet'
    ? { width: 900, height: 800 }
    : DESKTOP_VIEWPORT

const createScreenshotProject = (
  options: Parameters<typeof createStorybookProject>[0],
) => {
  const project = createStorybookProject(options)

  return {
    ...project,
    test: {
      ...project.test,
      browser: {
        ...project.test.browser,
        // Storybook capture uses CDP, which requires both browser API permissions.
        api: { allowWrite: true, allowExec: true },
      },
    },
  }
}

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          ...createScreenshotProject({
            name: 'storybook-screenshot-frontend',
            rootDir: dirname,
            viewport: desktopViewport,
            screenshotsSubdir: 'desktop',
            setupFiles: ['./.storybook/vitest.setup.screenshot.ts'],
            excludeTags: ['mobile-only'],
          }),
        },
        {
          extends: true,
          ...createScreenshotProject({
            name: 'storybook-screenshot-frontend-mobile',
            rootDir: dirname,
            viewport: MOBILE_VIEWPORT,
            screenshotsSubdir: 'mobile',
            setupFiles: ['./.storybook/vitest.setup.screenshot.ts'],
            excludeTags: ['desktop-only'],
          }),
        },
      ],
    },
  }),
)
