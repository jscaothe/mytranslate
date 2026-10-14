import { expect, test, type Page } from '@playwright/test'

// A Japanese user (Windows in Japanese): the app speaks Japanese, reads the Vietnamese team's messages in
// Japanese, and turns the Japanese they write into Vietnamese in the message box.

test.use({ locale: 'ja-JP' })

const popup = (page: Page) => page.locator('[data-popup]')
const composer = (page: Page) => page.locator('textarea[data-composer]')

/** Drags the mouse over a whole message, like a user selecting it (the toolbar appears where the drag ends). */
async function selectMessage(page: Page, text: string) {
  const box = (await page.locator('p[lang=vi]', { hasText: text }).first().boundingBox())!
  await page.mouse.move(box.x + 1, box.y + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 1, box.y + box.height - 4, { steps: 8 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(composer(page)).toBeVisible()
})

test('the app follows Windows: Japanese texts and a chat with the Vietnamese team', async ({ page }) => {
  await expect(page.getByRole('button', { name: '使ってみる' })).toBeVisible()
  await expect(page.getByText('ベトナム側のメッセージを読む')).toBeVisible()
  await expect(page.locator('p[lang=vi]', { hasText: 'Về lịch release tháng 11' })).toBeVisible()
  await expect(composer(page)).toHaveAttribute('placeholder', '#dev-qa へのメッセージ')
})

test('a Vietnamese message is read in Japanese with the mouse, without any hotkey', async ({ page }) => {
  await selectMessage(page, 'Về lịch release tháng 11')
  const bar = page.locator('[data-quick-bar]')
  await expect(bar.getByRole('button', { name: '翻訳', exact: true })).toBeVisible()
  await bar.getByRole('button', { name: '翻訳', exact: true }).click()

  await expect(popup(page)).toHaveAttribute('data-direction', 'vi_ja')
  await expect(popup(page).locator('p[lang=ja]')).toHaveText('11月のリリース日程について、来週の水曜日を提案します。いかがでしょうか。')
  await expect(popup(page).getByRole('button', { name: /返信/ }).first()).toBeVisible()
})

test('Japanese in the message box becomes Vietnamese, checked by reading it back in Japanese', async ({ page }) => {
  await composer(page).fill('来週の水曜日で大丈夫です。詳しいスケジュールを送ってください。')
  await page.keyboard.press('Control+Alt+T')

  await expect(popup(page)).toHaveAttribute('data-direction', 'ja_vi')
  const draft = popup(page).locator('textarea[data-role=draft]')
  await expect(draft).toBeVisible()
  await expect(draft).toHaveAttribute('lang', 'vi')
  await expect(popup(page).getByText('読み返したときの意味')).toBeVisible()
  await expect(popup(page).locator('p[lang=ja]').last()).toContainText('来週の水曜日')
  // The register of the Vietnamese, named for a Japanese user.
  await expect(popup(page).getByRole('radiogroup', { name: '丁寧さ' })).toBeVisible()

  const vietnamese = await draft.inputValue()
  expect(vietnamese).toContain('Thứ Tư tuần sau')
  await draft.focus()
  await page.keyboard.press('Enter')
  await expect(popup(page)).toBeHidden()
  await expect(composer(page)).toHaveValue(vietnamese)
})

test('a reply typed in Japanese from the reading popup is translated into Vietnamese', async ({ page }) => {
  await page.locator('p[lang=vi]', { hasText: 'Về lịch release tháng 11' }).click({ clickCount: 3 })
  await page.keyboard.press('Control+Alt+T')
  await expect(popup(page)).toHaveAttribute('data-direction', 'vi_ja')
  await expect(popup(page).getByRole('button', { name: /返信/ }).first()).toBeEnabled()
  await expect(popup(page).getByRole('button', { name: /返信案/ })).toHaveCount(0)

  await popup(page).press('Control+Enter')
  const reply = popup(page).locator('textarea[data-role=reply]')
  await expect(reply).toHaveAttribute('placeholder', '日本語（自動で翻訳）またはベトナム語で返信を入力…')
  await reply.fill('確認しました。本番に反映してください。')
  await reply.press('Enter')

  const result = popup(page).locator('[data-reply-result]')
  await expect(result.getByText('翻訳した返信')).toBeVisible()
  await expect(result.locator('p[lang=vi]')).toContainText('production')
  await reply.press('Enter')
  await expect(popup(page)).toBeHidden()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('production')
})

test('a reply written straight in Vietnamese is checked in Vietnamese', async ({ page }) => {
  await page.locator('p[lang=vi]', { hasText: 'Về lịch release tháng 11' }).click({ clickCount: 3 })
  await page.keyboard.press('Control+Alt+T')
  await expect(popup(page).getByRole('button', { name: /返信/ }).first()).toBeEnabled()
  await popup(page).press('Control+Enter')
  const reply = popup(page).locator('textarea[data-role=reply]')
  await reply.fill('Tôi đã check lại, ko thấy lỗi nữa.')
  await reply.press('Enter')

  const result = popup(page).locator('[data-reply-result]')
  await expect(result.getByText('返信のチェック')).toBeVisible()
  await expect(result.locator('[data-issue]').first()).toBeVisible()
  await expect(popup(page).getByRole('button', { name: /修正案をコピー/ })).toBeEnabled()
})

test('the language can be switched in Settings, and the whole app follows', async ({ page }) => {
  await page.keyboard.press('Control+Alt+M')
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()

  await page.getByRole('radiogroup', { name: 'あなたの言語' }).getByRole('radio', { name: 'Tiếng Việt' }).click()
  await expect(page.getByRole('heading', { name: 'Cài đặt' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Phím tắt: Dịch (tự chọn ngôn ngữ đích)' })).toHaveText('CtrlAltT')

  await page.getByRole('radiogroup', { name: 'Ngôn ngữ của bạn' }).getByRole('radio', { name: '日本語' }).click()
  await expect(page.getByRole('button', { name: 'ショートカット: 翻訳（翻訳先の言語を自動で判断）' })).toHaveText('CtrlAltT')
})

test('the first-run guide is in Japanese and practises on a Vietnamese message', async ({ page }) => {
  await page.getByRole('button', { name: '初期設定ガイド' }).click()
  await expect(page.getByRole('heading', { name: 'チャット欄で、そのまま日越翻訳' })).toBeVisible()
  await page.getByRole('button', { name: '次へ' }).click()
  await expect(page.getByRole('heading', { name: '翻訳に使うAIを選んでください' })).toBeVisible()
  await page.getByRole('button', { name: /Claude アカウント/ }).click()
  await expect(page.getByRole('button', { name: '次へ' })).toBeEnabled()
  await page.getByRole('button', { name: '次へ' }).click()

  const sample = page.locator('p[lang=vi]', { hasText: 'Em gửi anh tài liệu' })
  await expect(sample).toBeVisible()
  await sample.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  // Only "translate": the sample is the other side's message, with nothing of the user's own to check.
  const bar = page.locator('[data-quick-bar]')
  await expect(bar.getByRole('button', { name: /チェック/ })).toHaveCount(0)
  await bar.getByRole('button', { name: '翻訳', exact: true }).click()
  await expect(popup(page)).toHaveAttribute('data-direction', 'vi_ja')
})

test('Japanese checked as Japanese, with the explanations and writing advice in Japanese', async ({ page }) => {
  await composer(page).fill('明日までに確認してください。')
  await page.keyboard.press('Control+Alt+C')
  await expect(popup(page)).toHaveAttribute('data-direction', 'review_ja')
  await expect(popup(page).locator('[data-issue=politeness]')).toContainText('敬語')
  await expect(popup(page).locator('[data-issue=politeness]')).toContainText('命令的')
  await popup(page).getByRole('button', { name: '閉じる', exact: true }).click()

  await page.getByRole('button', { name: 'メイン画面' }).click()
  await page.getByRole('button', { name: '文章力', exact: true }).click()
  // A Japanese user writes Vietnamese to the other side: that is shown first.
  await expect(page.getByRole('radiogroup', { name: '文の言語' }).getByRole('radio', { name: 'ベトナム語' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('呼び方').first()).toBeVisible()
  await page.getByRole('button', { name: '自分の誤りを分析' }).click()
  await expect(page.getByText('略語を使わない')).toBeVisible()
})
