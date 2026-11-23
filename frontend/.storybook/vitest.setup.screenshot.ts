import { screenshot } from '@storycap-testrun/browser'
import { afterEach, vi } from 'vitest'
import { page } from 'vitest/browser'

// Relative-time UI (e.g. "3 minutes ago") renders differently on every run
// unless the system clock is pinned.
vi.setSystemTime(new Date('2024-01-01T00:00:00+09:00'))

afterEach(async (context) => {
  await screenshot(page, context)
})
