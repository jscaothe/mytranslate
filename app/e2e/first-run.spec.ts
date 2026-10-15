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

test('the guide shows where the toolbar appears: every app by default, or a chosen list', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Onboarding' }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByRole('button', { name: /Tài khoản Claude/ }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()

  const scope = page.getByRole('radiogroup', { name: 'Hiện trong ứng dụng nào' })
  await expect(scope.getByRole('radio', { name: 'Mọi ứng dụng' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Mọi ứng dụng, trừ các ứng dụng bị chặn ở mục Phím tắt.')).toBeVisible()

  await scope.getByRole('radio', { name: 'Ứng dụng đã chọn' }).click()
  const list = page.getByRole('list', { name: 'Ứng dụng hiện thanh thao tác' })
  await expect(list.getByText('slack.exe')).toBeVisible()

  // The same setting as in Settings.
  await page.getByRole('button', { name: 'Hoàn tất, thu nhỏ về khay' }).click()
  await page.getByRole('button', { name: 'Cửa sổ chính' }).click()
  await page.getByRole('button', { name: 'Cài đặt' }).click()
  await page.getByRole('button', { name: 'Thanh thao tác nhanh' }).click()
  await expect(
    page.getByRole('radiogroup', { name: 'Hiện trong ứng dụng nào' }).getByRole('radio', { name: 'Ứng dụng đã chọn' }),
  ).toHaveAttribute('aria-checked', 'true')
})

test('the first real popup explains the keys once', async ({ page }) => {
  await page.goto('/')
  const message = '[data-chat-messages] [lang=ja]'

  await selectStart(page, message, 10)
  await page.keyboard.press('Control+Alt+T')
  const tip = popup(page).getByRole('note')
  await expect(tip).toContainText('để gõ câu trả lời')
  await tip.getByRole('button', { name: 'Đã hiểu' }).click()
  await expect(tip).toHaveCount(0)
  await popup(page).getByRole('button', { name: 'Đóng', exact: true }).click()
  await expect(popup(page)).toBeHidden()

  await selectStart(page, message, 10)
  await page.keyboard.press('Control+Alt+T')
  await expect(popup(page)).toHaveAttribute('data-direction', 'ja_vi')
  await expect(popup(page).getByRole('button', { name: /Sao chép/ })).toBeEnabled()
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

test('without Claude Code the guide installs it, signs in and tries a translation by itself', async ({ page }) => {
  await page.goto('/')
  await page.locator('select').filter({ hasText: 'Bình thường' }).selectOption('no_claude')
  await page.getByRole('button', { name: 'Onboarding' }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()

  const claude = page.getByRole('button', { name: /Tài khoản Claude/ })
  await expect(claude).toBeVisible()
  await expect(page.getByText('Sẵn sàng trên máy này')).toHaveCount(0)
  await claude.click()

  // Nothing to press: install, sign-in page, test translation follow one another.
  await expect(page.getByText('Máy chưa có Claude Code, đang tự tải và cài bản chính hãng…')).toBeVisible()
  await expect(page.getByText('Mời bạn đăng nhập Claude trên trình duyệt vừa mở.')).toBeVisible()
  await expect(page.getByText(/Dịch thử thành công, chữ đầu tiên sau/)).toBeVisible()
  await expect(page.getByText('Đã cài Claude Code')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeEnabled()
})

test('a ChatGPT account is set up the same way, through Codex', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Onboarding' }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()

  await page.getByRole('button', { name: /Tài khoản ChatGPT/ }).click()
  await expect(page.getByRole('heading', { name: 'Dùng tài khoản ChatGPT' })).toBeVisible()
  await expect(page.getByRole('progressbar')).toBeVisible()
  await expect(page.getByText(/Đã cài Codex .*, bản chính hãng của OpenAI/)).toBeVisible()
  await expect(page.getByText('Đã đăng nhập bằng tài khoản ChatGPT của bạn')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeEnabled()
})

test('a failed test translation says why and offers to try again', async ({ page }) => {
  await page.goto('/')
  await page.locator('select').filter({ hasText: 'Bình thường' }).selectOption('quota')
  await page.getByRole('button', { name: 'Onboarding' }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  await page.getByRole('button', { name: /Tài khoản Claude/ }).click()

  await expect(page.getByText('Đã hết hạn mức gói Claude. Thử lại sau khi hạn mức được làm mới.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeDisabled()
})

test('an API key still works under Advanced', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Onboarding' }).click()
  await page.getByRole('button', { name: 'Tiếp tục' }).click()
  const next = page.getByRole('button', { name: 'Tiếp tục' })

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
