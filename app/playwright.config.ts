import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests of the user interface, run against the browser prototype: the same React screens as the
 * desktop app, with canned translations instead of Claude, so the tests are fast, free and repeatable.
 * The Rust side (capture, hotkeys, history, prompt) is covered by `cargo test`.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    // The installed Chrome locally; CI installs Playwright's Chromium.
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 1400, height: 860 },
    locale: 'vi-VN',
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
  },
  webServer: {
    // Its own port, so a running `tauri dev` (5173) does not get in the way.
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
  },
})
