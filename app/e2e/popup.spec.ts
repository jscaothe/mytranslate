import { expect, test, type Page } from '@playwright/test'

// The "Mô phỏng sử dụng" screen: a fake Slack/Teams where the hotkeys open the translation popup.

const popup = (page: Page) => page.locator('[data-popup]')
const composer = (page: Page) => page.locator('textarea[data-composer]')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(composer(page)).toBeVisible()
})

test('the same key reads Japanese typed in the composer without replacing it', async ({ page }) => {
  await composer(page).fill('仕訳の入力画面でエラーが出ています。')
  await page.keyboard.press('Control+Alt+T')

  await expect(popup(page)).toHaveAttribute('data-direction', 'ja_vi')
  await expect(popup(page).locator('textarea[data-role=draft]')).toHaveCount(0)
  await expect(popup(page).getByRole('button', { name: /Thay vào chat/ })).toHaveCount(0)
  await expect(composer(page)).toHaveValue('仕訳の入力画面でエラーが出ています。')
})

test('Vietnamese in the composer is translated and Enter puts it back in the chat', async ({ page }) => {
  await composer(page).fill('Em đã sửa lỗi đăng nhập, anh kiểm tra giúp em nhé')
  await page.keyboard.press('Control+Alt+T')

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

test('a message of several lines keeps its lines in the reading back', async ({ page }) => {
  await composer(page).fill('・Đã sửa lỗi đăng nhập\n・Đã cập nhật spec màn hình B')
  await page.keyboard.press('Control+Alt+T')

  const draft = popup(page).locator('textarea[data-role=draft]')
  await expect(draft).toBeVisible()
  expect((await draft.inputValue()).split('\n')).toHaveLength(2)
  // innerText follows the rendering, so lines collapsed by CSS would come back joined by a space.
  const back = popup(page).getByText('Ý nghĩa khi đọc lại').locator('..').locator('p[lang=vi]')
  expect((await back.innerText()).split('\n')).toHaveLength(2)
})

test('a Japanese message is translated and Claude suggests replies that can be copied', async ({ page }) => {
  await page.locator('p[lang=ja]').first().click({ clickCount: 3 })
  await page.keyboard.press('Control+Alt+T')

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
  await page.keyboard.press('Control+Alt+C')
  await expect(popup(page)).toHaveAttribute('data-direction', 'review_ja')
  await expect(popup(page).locator('[data-issue=politeness]')).toContainText('Kính ngữ')
  await expect(popup(page).getByRole('button', { name: /Dùng đề xuất/ })).toBeEnabled()
  await popup(page).getByRole('button', { name: /Dùng đề xuất/ }).click()
  await expect(popup(page)).toBeHidden()
  await expect(composer(page)).not.toHaveValue('明日までに確認してください')
})

test('Vietnamese the user wrote is checked as Vietnamese, not translated into Japanese', async ({ page }) => {
  await composer(page).fill('e đã check lại rồi, ko thấy lỗi nữa ạ')
  await page.keyboard.press('Control+Alt+C')
  await expect(popup(page)).toHaveAttribute('data-direction', 'review_vi')
  // "Kiểm tra VI" only shows while the review loads, which a fast run can miss; the verdict is what stays.
  await expect(popup(page).getByText('Nên sửa', { exact: true })).toBeVisible()
  const issues = popup(page).locator('[data-issue]')
  await expect(issues).toHaveCount(3)
  await expect(popup(page).locator('[data-issue=spelling]')).toContainText('Chính tả')
  await expect(popup(page).locator('[data-issue=politeness]')).toContainText('Xưng hô')
  // Nothing Japanese: no translation, and the suggestion is Vietnamese.
  await expect(popup(page).locator('textarea[data-role=draft]')).toHaveCount(0)
  await expect(popup(page).locator('p[lang=ja]')).toHaveCount(0)
  await popup(page).getByRole('button', { name: /Dùng đề xuất/ }).click()
  await expect(composer(page)).toHaveValue('em đã kiểm tra lại rồi, không thấy lỗi nữa ạ')
})

test('a review shows the suggestion first, then at most three main points', async ({ page }) => {
  await composer(page).fill('e đã check lại rồi, ko thấy lỗi, đc chưa ạ')
  await page.keyboard.press('Control+Alt+C')
  const suggestion = popup(page).getByText('Đề xuất', { exact: true })
  const points = popup(page).getByText('Góp ý chính', { exact: true })
  await expect(points).toBeVisible()
  expect((await suggestion.boundingBox())!.y).toBeLessThan((await points.boundingBox())!.y)
  // Four mistakes: three spelled out, the fourth only counted; the suggestion fixes all four.
  await expect(popup(page).locator('[data-issue]')).toHaveCount(3)
  await expect(popup(page).getByText('Và 1 góp ý nhỏ khác, đã được sửa trong đề xuất.')).toBeVisible()
  await popup(page).getByRole('button', { name: /Dùng đề xuất/ }).click()
  await expect(composer(page)).toHaveValue('em đã kiểm tra lại rồi, không thấy lỗi, được chưa ạ')
})

test('Tab changes the keigo level and translates again', async ({ page }) => {
  await composer(page).fill('Cảm ơn anh')
  await page.keyboard.press('Control+Alt+T')
  const keigo = popup(page).getByRole('radiogroup', { name: 'Mức kính ngữ' })
  await expect(popup(page).locator('textarea[data-role=draft]')).toBeVisible()
  const before = await keigo.getByRole('radio', { checked: true }).textContent()
  await popup(page).press('Tab')
  await expect(keigo.getByRole('radio', { checked: true })).not.toHaveText(before ?? '')
  await expect(popup(page).locator('textarea[data-role=draft]')).toBeVisible()
})

test('the popup names the chat it reads from, with no thread to pick', async ({ page }) => {
  await composer(page).fill('Cảm ơn anh')
  await page.keyboard.press('Control+Alt+T')
  await expect(popup(page).locator('textarea[data-role=draft]')).toBeVisible()
  const header = popup(page).locator('header')
  await expect(header).toContainText('#dev-qa')
  await expect(header.getByRole('button', { name: /thread/i })).toHaveCount(0)
  // Ctrl+T used to open the thread picker; now it does nothing in the popup.
  await popup(page).press('Control+t')
  await expect(popup(page).getByRole('dialog')).toHaveCount(0)
  await expect(popup(page).getByRole('listbox')).toHaveCount(0)
  await expect(popup(page).getByPlaceholder(/thread/i)).toHaveCount(0)
})

test('Escape closes the popup and leaves the composer alone', async ({ page }) => {
  await composer(page).fill('Xin chào')
  await page.keyboard.press('Control+Alt+T')
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
  await page.keyboard.press('Control+Alt+T')
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

test('the AI menu stays on top of the popup window and inside it', async ({ page }) => {
  await composer(page).fill('Cảm ơn anh')
  await page.keyboard.press('Control+Alt+T')
  await expect(popup(page).locator('textarea[data-role=draft]')).toBeVisible()
  // The prototype draws the popup inside the page: give it the popup window's entrance, whose parts animate apart.
  await popup(page).evaluate((el) => el.classList.replace('anim-popup', 'anim-reveal'))
  await page.setViewportSize({ width: 1400, height: 560 })
  await popup(page).getByRole('button', { name: /^AI dịch/ }).click()

  const menu = popup(page).getByRole('menu', { name: 'Chọn AI dịch' })
  const item = (await menu.getByRole('menuitemradio', { name: 'Haiku' }).boundingBox())!
  const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[role=menu]'), [item.x + 20, item.y + item.height / 2])
  expect(hit).toBe(true)
  const box = (await menu.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(560)

  // Pressing in the menu, such as on its scrollbar or a group name, does not move the popup.
  const before = (await popup(page).boundingBox())!
  const label = (await menu.getByText('Claude').first().boundingBox())!
  await page.mouse.move(label.x + 10, label.y + label.height / 2)
  await page.mouse.down()
  await page.mouse.move(label.x + 10, label.y + 120, { steps: 5 })
  await page.mouse.up()
  expect(await popup(page).boundingBox()).toEqual(before)
})

test('when Claude refuses MyTranslate, another AI translates the same text in one click', async ({ page }) => {
  await page.locator('select').filter({ hasText: 'Bình thường' }).selectOption('blocked')
  await composer(page).fill('仕訳の入力画面でエラーが出ています。')
  await page.keyboard.press('Control+Alt+T')

  await expect(popup(page).getByText('Claude từ chối yêu cầu từ MyTranslate')).toBeVisible()
  await expect(popup(page).getByText(/Tài khoản Claude của bạn vẫn bình thường/)).toBeVisible()
  await popup(page).getByRole('button', { name: 'ChatGPT API · GPT-5.6 Luna' }).click()
  await expect(popup(page).getByText('Claude từ chối yêu cầu từ MyTranslate')).toHaveCount(0)
  await expect(popup(page).getByRole('button', { name: /Sao chép/ })).toBeEnabled()
})
