import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BLOCK_EXTERNAL_REQUESTS_ARGS } from '@fohte/storybook-addon/vitest-plugin'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      exclude: ['src/editor/__tests__/markdown-editor-setup.test.tsx'],
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            exclude: [
              '**/node_modules/**',
              '**/dist/**',
              '**/*.browser.test.tsx',
              'src/editor/__tests__/markdown-editor-setup.test.tsx',
            ],
          },
        },
        {
          extends: true,
          test: {
            name: 'browser-unit',
            include: ['src/**/*.browser.test.tsx'],
            exclude: ['src/**/*.ime.browser.test.tsx'],
            browser: {
              enabled: true,
              provider: playwright({
                launchOptions: { args: [...BLOCK_EXTERNAL_REQUESTS_ARGS] },
              }),
              headless: true,
              instances: [{ browser: 'chromium' }],
            },
          },
        },
        {
          extends: true,
          test: {
            name: 'browser-ime-chromium',
            include: ['src/editor/markdown-editor.ime.browser.test.tsx'],
            browser: {
              enabled: true,
              api: { allowWrite: true, allowExec: true },
              provider: playwright({
                launchOptions: { args: [...BLOCK_EXTERNAL_REQUESTS_ARGS] },
              }),
              headless: true,
              instances: [{ browser: 'chromium' }],
            },
          },
        },
        {
          extends: true,
          test: {
            name: 'browser-ime-webkit',
            include: ['src/editor/markdown-editor.ime.browser.test.tsx'],
            browser: {
              enabled: true,
              provider: playwright({
                launchOptions: { args: [...BLOCK_EXTERNAL_REQUESTS_ARGS] },
              }),
              headless: true,
              instances: [{ browser: 'webkit' }],
            },
          },
        },
        {
          extends: true,
          plugins: [
            storybookTest({ configDir: path.join(dirname, '.storybook') }),
          ],
          test: {
            name: 'storybook',
            browser: {
              enabled: true,
              provider: playwright({
                launchOptions: { args: [...BLOCK_EXTERNAL_REQUESTS_ARGS] },
              }),
              headless: true,
              instances: [{ browser: 'chromium' }],
            },
            setupFiles: ['./.storybook/vitest.setup.ts'],
          },
        },
      ],
    },
  }),
)
