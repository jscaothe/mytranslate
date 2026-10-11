import { expect, test, type Page } from '@playwright/test'

// The "Mô phỏng sử dụng" screen: a fake Slack/Teams where the hotkeys open the translation popup.

const popup = (page: Page) => page.locator('[data-popup]')
const composer = (page: Page) => page.locator('textarea[data-composer]')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(composer(page)).toBeVisible()
})

test('Vietnamese in the composer is translated and Enter puts it back in the chat', async ({ page }) => {
  await composer(page).fill('Em đã sửa lỗi đăng nhập, anh kiểm tra giúp em nhé')
  await page.keyboard.press('Control+Alt+K')

  const draft = popup(page).locator('textarea[data-role=draft]')
  await expect(draft).toBeVisible()
  await expect(popup(page).getByText('Ý nghĩa khi đọc lại')).toBeVisible()
  // Only the translation and its reading back: nothing else under it.
  await expect(popup(page).getByText('Mẫu câu')).toHaveCount(0)
  const translated = await draft.inputValue()
  expect(translated).not.toBe('')

  await draft.focus()
  await page.keyboard.press('Enter')
  await expect(popup(page)).toBeHidden()
  await expect(composer(page)).toHaveValue(translated)
})

test('a Japanese message is translated and Claude suggests replies that can be copied', async ({ page }) => {
  await page.locator('p[lang=ja]').first().click({ clickCount: 3 })
  await page.keyboard.press('Control+Alt+J')

  await expect(popup(page)).toHaveAttribute('data-direction', 'ja_vi')
  const suggest = popup(page).getByRole('button', { name: /Gợi ý/ })
  await expect(suggest).toBeEnabled()
  await popup(page).press('g')

  const block = popup(page).getByText('Gợi ý trả lời').locator('..').locator('..')
  await expect(block.locator('span[lang=ja]')).toHaveCount(3)
  const first = await block.locator('span[lang=ja]').first().textContent()
  await block.locator('span[lang=ja]').first().click()
  await expect(page.getByRole('status').filter({ hasText: 'Đã sao chép câu trả lời' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first)
})

test('Japanese in the composer is reviewed and the suggestion replaces it', async ({ page }) => {
  await composer(page).fill('明日までに確認してください')
  await page.keyboard.press('Control+Alt+L')
  await expect(popup(page).getByRole('button', { name: /Dùng đề xuất/ })).toBeEnabled()
  await popup(page).getByRole('button', { name: /Dùng đề xuất/ }).click()
  await expect(popup(page)).toBeHidden()
  await expect(composer(page)).not.toHaveValue('明日までに確認してください')
})

test('Tab changes the keigo level and translates again', async ({ page }) => {
  await composer(page).fill('Cảm ơn anh')
  await page.keyboard.press('Control+Alt+K')
  const keigo = popup(page).getByRole('radiogroup', { name: 'Mức kính ngữ' })
  await expect(popup(page).locator('textarea[data-role=draft]')).toBeVisible()
  const before = await keigo.getByRole('radio', { checked: true }).textContent()
  await popup(page).press('Tab')
  await expect(keigo.getByRole('radio', { checked: true })).not.toHaveText(before ?? '')
  await expect(popup(page).locator('textarea[data-role=draft]')).toBeVisible()
})

test('Escape closes the popup and leaves the composer alone', async ({ page }) => {
  await composer(page).fill('Xin chào')
  await page.keyboard.press('Control+Alt+K')
  await expect(popup(page)).toBeVisible()
  await popup(page).press('Escape')
  await expect(popup(page)).toBeHidden()
  await expect(composer(page)).toHaveValue('Xin chào')
})

test('selecting text with the mouse shows the quick toolbar', async ({ page }) => {
  const message = page.locator('p[lang=ja]').first()
  const box = (await message.boundingBox())!
  await page.mouse.move(box.x + 4, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + Math.min(box.width - 4, 220), box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  const bar = page.locator('[data-quick-bar]')
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: /Dịch/ }).first().click()
  await expect(popup(page)).toBeVisible()
})

test('the AI can be switched from the popup, which translates again with it', async ({ page }) => {
  await composer(page).fill('Cảm ơn anh')
  await page.keyboard.press('Control+Alt+K')
  await expect(popup(page).locator('textarea[data-role=draft]')).toBeVisible()
  const chip = popup(page).getByRole('button', { name: /^AI dịch: Claude Sonnet/ })
  await expect(chip).toBeVisible()

  await popup(page).press('Control+m')
  const menu = popup(page).getByRole('menu', { name: 'Chọn AI dịch' })
  await expect(menu).toBeVisible()
  // No key for Gemini in the prototype: shown, but not selectable.
  await expect(menu.getByRole('menuitemradio', { name: 'Gemini 3.6 Flash' })).toBeDisabled()
  await menu.getByRole('menuitemradio', { name: 'Haiku' }).click()

  await expect(menu).toBeHidden()
  await expect(popup(page).getByRole('button', { name: /^AI dịch: Claude Haiku/ })).toBeVisible()
  await expect(popup(page).locator('textarea[data-role=draft]')).toBeVisible()
})
