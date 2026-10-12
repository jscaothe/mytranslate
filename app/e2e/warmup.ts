import { chromium, type FullConfig } from '@playwright/test'

/**
 * Loads the prototype once before any test runs. A fresh Vite server transforms every module on its first request;
 * with all workers asking at once that can take longer than a test's whole time budget.
 */
export default async function warmup(config: FullConfig) {
  const { baseURL, channel } = config.projects[0].use
  const browser = await chromium.launch({ channel })
  try {
    const page = await browser.newPage()
    await page.goto(baseURL!, { timeout: 120_000 })
    // React has rendered, so every module of the first screen has been served.
    await page.locator('#root > *').first().waitFor({ timeout: 120_000 })
  } finally {
    await browser.close()
  }
}
