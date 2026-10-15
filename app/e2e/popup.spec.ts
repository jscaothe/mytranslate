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

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

/** Opens the popup on the first Japanese message and waits for its translation. */
async function readFirstMessage(page: Page) {
  await page.locator('p[lang=ja]').first().click({ clickCount: 3 })
  await page.keyboard.press('Control+Alt+T')
  await expect(popup(page)).toHaveAttribute('data-direction', 'ja_vi')
  await expect(popup(page).getByRole('button', { name: /Sao chép/ })).toBeEnabled()
}

test('Enter copies the translation of a Japanese message, with no reply suggestions any more', async ({ page }) => {
  await readFirstMessage(page)
  await expect(popup(page).getByRole('button', { name: /Gợi ý/ })).toHaveCount(0)
  const translation = await popup(page).locator('p[lang=vi]').first().innerText()
  await popup(page).press('Enter')
  await expect(popup(page)).toBeHidden()
  expect(await clipboard(page)).toBe(translation)
})

test('Ctrl+Enter replies to a message; Enter translates the Vietnamese reply, shows it, then copies it', async ({ page }) => {
  await readFirstMessage(page)
  await popup(page).press('Control+Enter')
  const reply = popup(page).locator('textarea[data-role=reply]')
  await expect(reply).toBeFocused()
  await reply.fill('Em đã sửa xong rồi ạ')
  await expect(popup(page).getByRole('button', { name: /^Dịch(?! chưa tốt)/ })).toBeEnabled()

  // First Enter: the Japanese to send, with its meaning read back.
  await reply.press('Enter')
  const result = popup(page).locator('[data-reply-result]')
  await expect(result.getByText('Ý nghĩa khi đọc lại')).toBeVisible()
  const japanese = await result.locator('p[lang=ja]').innerText()
  // A message in the conversation cannot be typed over: the second Enter copies it.
  await expect(popup(page).getByRole('button', { name: /^Sao chép/ })).toBeEnabled()
  await reply.press('Enter')
  await expect(popup(page)).toBeHidden()
  expect(await clipboard(page)).toBe(japanese)
})

test('Ctrl+Enter in the reply skips looking: the Vietnamese reply is translated and copied at once', async ({ page }) => {
  await readFirstMessage(page)
  await popup(page).press('Control+Enter')
  const reply = popup(page).locator('textarea[data-role=reply]')
  await reply.fill('Em đã sửa xong rồi ạ')
  await expect(popup(page).getByRole('button', { name: /Sao chép ngay/ })).toBeEnabled()
  await reply.press('Control+Enter')
  await expect(popup(page)).toBeHidden()
  expect(await clipboard(page)).toMatch(/[ぁ-んァ-ン一-龯]/)
})

test('Shift+Enter starts a new line in the reply; Escape leaves nothing, the Hủy link leaves the reply', async ({ page }) => {
  await readFirstMessage(page)
  await popup(page).press('Control+Enter')
  const reply = popup(page).locator('textarea[data-role=reply]')
  await reply.fill('Dòng một')
  await reply.press('Shift+Enter')
  await reply.pressSequentially('Dòng hai')
  await expect(reply).toHaveValue('Dòng một\nDòng hai')
  // Escape also cancels a word in the Japanese input method: it must not throw the reply away.
  await reply.press('Escape')
  await expect(reply).toHaveValue('Dòng một\nDòng hai')
  await expect(popup(page).getByText('Esc', { exact: true })).toHaveCount(0)
  await popup(page).getByRole('button', { name: 'Hủy', exact: true }).click()
  await expect(reply).toHaveCount(0)
  await popup(page).press('Escape')
  await expect(popup(page)).toBeVisible()
})

test('a Japanese reply to Japanese in the message box is checked with Enter and replaces it with Enter', async ({ page }) => {
  await composer(page).fill('仕訳の入力画面でエラーが出ています。')
  await page.keyboard.press('Control+Alt+T')
  await expect(popup(page)).toHaveAttribute('data-direction', 'ja_vi')
  await expect(popup(page).getByRole('button', { name: /Sao chép/ })).toBeEnabled()
  await popup(page).press('Control+Enter')

  // Written straight in Japanese: checked in Japanese, not translated.
  const reply = popup(page).locator('textarea[data-role=reply]')
  await reply.fill('明日までに確認してください')
  await expect(popup(page).getByRole('button', { name: /^Kiểm tra/ })).toBeEnabled()
  await reply.press('Enter')
  const result = popup(page).locator('[data-reply-result]')
  await expect(result.getByText('Kiểm tra câu trả lời')).toBeVisible()
  await expect(result.locator('[data-issue=politeness]')).toContainText('Kính ngữ')
  const use = popup(page).getByRole('button', { name: /Thay bằng câu đã sửa/ })
  await expect(use).toBeEnabled()

  // Keeping one's own sentence is one click away; Enter still works from the reply box afterwards.
  await result.getByRole('checkbox').check()
  await expect(popup(page).getByRole('button', { name: /^Thay vào ô chat/ })).toBeEnabled()
  await result.getByRole('checkbox').uncheck()
  await expect(reply).toBeFocused()
  await reply.press('Enter')
  await expect(popup(page)).toBeHidden()
  const replaced = await composer(page).inputValue()
  expect(replaced).not.toBe('明日までに確認してください')
  expect(replaced).toContain('確認')
})

test('a Vietnamese reply is translated with Enter, read back, and Enter again puts the Japanese in the box', async ({ page }) => {
  await composer(page).fill('仕訳の入力画面でエラーが出ています。')
  await page.keyboard.press('Control+Alt+T')
  await expect(popup(page).getByRole('button', { name: /Sao chép/ })).toBeEnabled()
  await popup(page).press('Control+Enter')
  const reply = popup(page).locator('textarea[data-role=reply]')
  await reply.fill('Em sẽ kiểm tra và báo lại anh trong hôm nay')
  await reply.press('Enter')

  const result = popup(page).locator('[data-reply-result]')
  await expect(result.getByText('Câu trả lời đã dịch')).toBeVisible()
  await expect(result.getByText('Ý nghĩa khi đọc lại')).toBeVisible()
  const japanese = await result.locator('p[lang=ja]').innerText()

  // Changing the reply after the check marks the result as out of date.
  await reply.press('End')
  await reply.pressSequentially(' ạ')
  await expect(popup(page).getByText(/Bạn đã sửa câu trả lời/)).toBeVisible()
  await reply.press('Backspace')
  await reply.press('Backspace')
  await expect(popup(page).getByText(/Bạn đã sửa câu trả lời/)).toHaveCount(0)

  await reply.press('Enter')
  await expect(popup(page)).toBeHidden()
  await expect(composer(page)).toHaveValue(japanese)
})

test('Ctrl+A on text in the message box offers the toolbar, and the next key puts it away', async ({ page }) => {
  await composer(page).fill('Em đã sửa xong rồi ạ')
  await composer(page).press('Control+a')
  const bar = page.locator('[data-quick-bar]')
  await expect(bar).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(bar).toBeHidden()

  // An empty box has nothing to offer.
  await composer(page).fill('')
  await composer(page).press('Control+a')
  await expect(bar).toBeHidden()

  await composer(page).fill('Em đã sửa xong rồi ạ')
  await composer(page).press('Control+a')
  await bar.getByRole('button', { name: /Dịch/ }).first().click()
  await expect(popup(page)).toHaveAttribute('data-direction', 'vi_ja')
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

test('the keigo level picked in a chat is kept for its next translations, not for other chats', async ({ page }) => {
  const keigo = popup(page).getByRole('radiogroup', { name: 'Mức kính ngữ' })
  const draft = popup(page).locator('textarea[data-role=draft]')
  const translate = async (text: string) => {
    await composer(page).fill(text)
    await composer(page).focus()
    await page.keyboard.press('Control+Alt+T')
    await expect(draft).toBeVisible()
  }

  await translate('Cảm ơn anh')
  await expect(keigo.getByRole('radio', { checked: true })).toHaveText('Trang trọng')
  await keigo.getByRole('radio', { name: 'Thân mật' }).click()
  await expect(draft).toBeVisible()
  await draft.focus()
  await page.keyboard.press('Enter')
  await expect(popup(page)).toBeHidden()

  await translate('Em đã sửa xong rồi ạ')
  await expect(keigo.getByRole('radio', { checked: true })).toHaveText('Thân mật')
  await popup(page).getByRole('button', { name: 'Đóng' }).click()

  // Another chat starts from the default level.
  await page.getByRole('button', { name: 'general', exact: true }).click()
  await translate('Cảm ơn anh')
  await expect(keigo.getByRole('radio', { checked: true })).toHaveText('Trang trọng')
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

test('the close button closes the popup and leaves the composer alone; Escape does not', async ({ page }) => {
  await composer(page).fill('Xin chào')
  await page.keyboard.press('Control+Alt+T')
  await expect(popup(page)).toBeVisible()
  await popup(page).press('Escape')
  await expect(popup(page)).toBeVisible()
  await popup(page).getByRole('button', { name: 'Đóng', exact: true }).click()
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
  // Resting on a button teaches its shortcut, so next time the mouse is not needed.
  await expect(bar.getByRole('tooltip')).toHaveCount(0)
  await bar.getByRole('button', { name: /Dịch/ }).first().hover()
  await expect(bar.getByRole('tooltip')).toHaveText('Phím tắtCtrlAltT')
  await bar.getByRole('button', { name: /Kiểm tra/ }).hover()
  await expect(bar.getByRole('tooltip')).toHaveText('Phím tắtCtrlAltC')
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
