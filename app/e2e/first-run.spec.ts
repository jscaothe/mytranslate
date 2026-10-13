import { expect, test, type Page } from '@playwright/test'

// What a new user meets: the three-step guide, then the first translation popup with its one-time tip.

const popup = (page: Page) => page.locator('[data-popup]')

/** Selects the start of a text node with the mouse-up a real drag would end with. */
async function selectStart(page: Page, selector: string, length: number) {
  await page.locator(selector).first().evaluate((el, n) => {
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, Math.min(n, text.length))
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  }, length)
}

test('the guide asks for nothing and teaches the toolbar: select, press Dịch, read', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Onboarding' }).click()

  await expect(page.getByText('Bôi đen tin nhắn trong Teams hoặc Slack, rồi bấm Dịch. Chỉ vậy thôi.')).toBeVisible()
  // No step that asks the user to type anything.
  await expect(page.getByText('Hồ sơ')).toHaveCount(0)
  await expect(page.locator('textarea, input[type=text]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByRole('button', { name: /Tài khoản Claude/ }).click()
  const next = page.getByRole('button', { name: 'Tiếp tục' })
  await expect(next).toBeEnabled()
  await next.click()

  await expect(page.getByRole('heading', { name: 'Thử ngay' })).toBeVisible()
  await selectStart(page, 'p[lang=ja].cursor-text', 12)
  const bar = page.getByRole('toolbar', { name: 'Thao tác nhanh MyTranslate' })
  await expect(bar).toBeVisible()
  // Only the button that opens the popup, labelled the same whichever the language.
  await expect(bar.getByRole('button', { name: 'Kiểm tra' })).toHaveCount(0)
  await bar.getByRole('button', { name: 'Dịch', exact: true }).click()

  await expect(popup(page)).toHaveAttribute('data-direction', 'ja_vi')
  await expect(page.getByText('Trong Teams và Slack cũng làm y như vậy.')).toBeVisible()
  // The practice popup keeps the one-time tip for the first real one.
  await expect(popup(page).getByRole('note')).toHaveCount(0)
})

test('the first real popup explains the keys once', async ({ page }) => {
  await page.goto('/')
  const message = '[data-chat-messages] [lang=ja]'

  await selectStart(page, message, 10)
  await page.keyboard.press('Control+Alt+T')
  const tip = popup(page).getByRole('note')
  await expect(tip).toContainText('để gõ câu trả lời bằng tiếng Việt')
  await tip.getByRole('button', { name: 'Đã hiểu' }).click()
  await expect(tip).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(popup(page)).toBeHidden()

  await selectStart(page, message, 10)
  await page.keyboard.press('Control+Alt+T')
  await expect(popup(page)).toHaveAttribute('data-direction', 'ja_vi')
  await expect(popup(page).getByRole('button', { name: /Gợi ý/ })).toBeEnabled()
  await expect(popup(page).getByRole('note')).toHaveCount(0)
})

test('the ways to use an AI sit side by side; what the PC has only earns a badge', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Onboarding' }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()

  await expect(page.getByRole('heading', { name: 'Bạn muốn dịch bằng AI nào?' })).toBeVisible()
  const claude = page.getByRole('button', { name: /Tài khoản Claude/ })
  const chatgpt = page.getByRole('button', { name: /Tài khoản ChatGPT/ })
  await expect(claude).toBeVisible()
  await expect(chatgpt).toBeVisible()
  await expect(page.getByRole('button', { name: /Tôi chưa có tài khoản AI/ })).toBeVisible()
  // Claude Code is signed in on this PC: a badge, not a choice made for the user.
  await expect(claude.getByText('Sẵn sàng trên máy này')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled()

  await claude.click()
  await expect(page.getByRole('heading', { name: 'Dùng tài khoản Claude' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeEnabled()
  await page.getByRole('button', { name: 'Chọn cách khác' }).click()
  await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled()
})

test('without Claude Code there is no badge, and an API key still works under Advanced', async ({ page }) => {
  await page.goto('/')
  await page.locator('select').filter({ hasText: 'Bình thường' }).selectOption('no_claude')
  await page.getByRole('button', { name: 'Onboarding' }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()

  const claude = page.getByRole('button', { name: /Tài khoản Claude/ })
  await expect(claude).toBeVisible()
  await expect(page.getByText('Sẵn sàng trên máy này')).toHaveCount(0)
  const next = page.getByRole('button', { name: 'Tiếp tục' })

  // Claude needs installing first; the guide points there.
  await claude.click()
  await expect(page.getByRole('button', { name: 'Mở hướng dẫn cài đặt' })).toBeVisible()
  await expect(next).toBeDisabled()
  await page.getByRole('button', { name: 'Chọn cách khác' }).click()

  await page.getByRole('button', { name: /Nâng cao: tôi có API key/ }).click()
  await expect(page.getByRole('heading', { name: 'Dùng API key' })).toBeVisible()
  await page.getByRole('tab', { name: 'ChatGPT' }).click()
  await page.getByLabel('API key ChatGPT').fill('sk-test')
  await page.getByRole('button', { name: 'Lưu và dịch thử' }).click()
  await expect(page.getByText('Dịch thử thành công')).toBeVisible()
  await expect(next).toBeEnabled()
  await next.click()
  await expect(page.getByRole('heading', { name: 'Thử ngay' })).toBeVisible()
})
