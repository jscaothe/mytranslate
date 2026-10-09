import { configDefaults, defineConfig } from 'vitest/config'

// Unit tests only: the browser end-to-end tests in e2e/ run with Playwright (`npm run e2e`).
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'e2e/**'] },
})
