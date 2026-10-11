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
  const next = page.getByRole('button', { name: 'Tiếp tục' })
  await expect(next).toBeEnabled()
  await next.click()

  await expect(page.getByRole('heading', { name: 'Thử ngay' })).toBeVisible()
  await selectStart(page, 'p[lang=ja].cursor-text', 12)
  const bar = page.getByRole('toolbar', { name: 'Thao tác nhanh MyTranslate' })
  await expect(bar).toBeVisible()
  // Only buttons that open the popup; "Dịch và chép" would copy silently.
  await expect(bar.getByRole('button', { name: 'Dịch và chép' })).toHaveCount(0)
  await bar.getByRole('button', { name: 'Dịch sang Việt' }).click()

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
