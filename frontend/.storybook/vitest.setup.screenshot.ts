import { screenshot } from '@storycap-testrun/browser'
import { afterEach, beforeEach, vi } from 'vitest'
import { page } from 'vitest/browser'

import { SCREENSHOT_VIEWPORT } from './screenshot-viewport'

// Relative-time UI (e.g. "3 minutes ago") renders differently on every run
// unless the system clock is pinned.
vi.setSystemTime(new Date('2024-01-01T00:00:00+09:00'))

beforeEach(async () => {
  await page.viewport(SCREENSHOT_VIEWPORT.width, SCREENSHOT_VIEWPORT.height)
})

afterEach(async (context) => {
  await screenshot(page, context)
})
