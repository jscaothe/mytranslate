import { expect, test, type Page } from '@playwright/test'

// The main window: Threads, Contacts, Glossary and Settings, with the prototype's sample data.

const openTab = async (page: Page, tab: string) => {
  await page.getByRole('button', { name: 'Cửa sổ chính' }).click()
  await page.getByRole('button', { name: tab, exact: true }).click()
}

const threadList = (page: Page) => page.locator('div.w-\\[280px\\]')
const header = (page: Page) => page.locator('h2').first()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('pinning a thread unpins the other thread of the same conversation', async ({ page }) => {
  await openTab(page, 'Threads')
  await threadList(page).getByRole('button', { name: /Lịch release tháng 11/ }).click()
  await page.getByRole('button', { name: /^Ghim thread/ }).click()
  await expect(page.getByRole('button', { name: 'Bỏ ghim thread' })).toBeVisible()
  // The pinned thread moves to the top of its conversation.
  await expect(threadList(page).getByRole('button').filter({ hasText: 'CustomerX' }).first()).toHaveCount(0)
  await expect(threadList(page).locator('button').nth(0)).toContainText('Lịch release tháng 11')

  await threadList(page).getByRole('button', { name: /Câu hỏi về API thanh toán/ }).click()
  await page.getByRole('button', { name: /^Ghim thread/ }).click()
  await expect(threadList(page).getByLabel('Đang ghim')).toHaveCount(1)
})

test('archiving hides a thread until it is restored', async ({ page }) => {
  await openTab(page, 'Threads')
  await threadList(page).getByRole('button', { name: /Họp định kỳ hằng tuần/ }).click()
  await page.getByRole('button', { name: 'Thêm' }).click()
  await page.getByRole('menuitem', { name: 'Lưu trữ' }).click()
  await expect(threadList(page).getByRole('button', { name: /Họp định kỳ hằng tuần/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Đã lưu trữ (1)' }).click()
  await threadList(page).getByRole('button', { name: /Họp định kỳ hằng tuần/ }).click()
  await expect(page.getByText('Đã lưu trữ', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Thêm' }).click()
  await page.getByRole('menuitem', { name: 'Bỏ lưu trữ' }).click()
  await page.getByRole('button', { name: 'Thread đang dùng' }).click()
  await expect(threadList(page).getByRole('button', { name: /Họp định kỳ hằng tuần/ })).toBeVisible()
})

test('merging moves every message into the chosen thread', async ({ page }) => {
  await openTab(page, 'Threads')
  await threadList(page).getByRole('button', { name: /Câu hỏi về API thanh toán/ }).click()
  await page.getByRole('button', { name: 'Thêm' }).click()
  await page.getByRole('menuitem', { name: 'Gộp vào thread khác' }).click()
  await page.getByRole('menu', { name: 'Gộp vào' }).getByRole('menuitem', { name: /Lỗi đăng nhập màn hình A/ }).click()

  await expect(threadList(page).getByRole('button', { name: /Câu hỏi về API thanh toán/ })).toHaveCount(0)
  await expect(header(page)).toContainText('Lỗi đăng nhập màn hình A')
  await expect(page.getByText('決済APIのタイムアウトは何秒に設定されていますか。')).toBeVisible()
})

test('a thread can be renamed and summarized again', async ({ page }) => {
  await openTab(page, 'Threads')
  await page.getByRole('button', { name: 'Đổi tên' }).click()
  const input = page.getByRole('textbox', { name: 'Tên thread' })
  await input.fill('Lỗi đăng nhập sau deploy')
  await input.press('Enter')
  await expect(header(page)).toContainText('Lỗi đăng nhập sau deploy')

  await page.getByRole('button', { name: 'Cập nhật', exact: true }).click()
  await expect(page.getByText('Đang tóm tắt…')).toBeVisible()
  await expect(page.getByText(/^Tóm tắt mô phỏng/)).toBeVisible()
})

test('the keigo level is set per conversation', async ({ page }) => {
  await openTab(page, 'Người liên hệ')
  const general = page.getByRole('radiogroup', { name: 'Mức kính ngữ với #general' })
  await general.getByRole('radio', { name: 'Thân mật' }).click()
  await expect(general.getByRole('radio', { name: 'Thân mật' })).toHaveAttribute('aria-checked', 'true')
  await general.getByRole('radio', { name: /Mặc định/ }).click()
  await expect(general.getByRole('radio', { name: /Mặc định/ })).toHaveAttribute('aria-checked', 'true')
})

test('glossary: add a personal term and filter by scope', async ({ page }) => {
  await openTab(page, 'Glossary')
  await page.getByPlaceholder('Tiếng Nhật').fill('本番環境')
  await page.getByPlaceholder('Tiếng Việt').fill('môi trường production')
  await page.getByRole('button', { name: 'Thêm' }).click()
  await expect(page.getByRole('cell', { name: '本番環境' })).toBeVisible()

  await page.getByRole('radiogroup', { name: 'Lọc phạm vi' }).getByRole('radio', { name: 'Dự án' }).click()
  await expect(page.getByRole('cell', { name: '本番環境' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: '受入テスト' })).toBeVisible()
})

test('a thread is deleted only after confirming', async ({ page }) => {
  await openTab(page, 'Threads')
  await threadList(page).getByRole('button', { name: /Lịch release tháng 11/ }).click()
  await page.getByRole('button', { name: 'Thêm' }).click()
  await page.getByRole('menuitem', { name: 'Xóa thread' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Xóa thread' })
  await expect(confirm).toContainText('không thể hoàn tác')
  await confirm.getByRole('button', { name: 'Hủy' }).click()
  await expect(threadList(page).getByRole('button', { name: /Lịch release tháng 11/ })).toBeVisible()

  await page.getByRole('button', { name: 'Thêm' }).click()
  await page.getByRole('menuitem', { name: 'Xóa thread' }).click()
  await confirm.getByRole('button', { name: 'Xóa thread' }).click()
  await expect(threadList(page).getByRole('button', { name: /Lịch release tháng 11/ })).toHaveCount(0)
  // Another thread opens in its place.
  await expect(header(page)).not.toHaveText('Lịch release tháng 11')
})

test('deleting a contact removes its threads too', async ({ page }) => {
  await openTab(page, 'Người liên hệ')
  await page.getByRole('button', { name: 'Xóa general' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Xóa general' })
  await expect(confirm).toContainText('1 thread')
  await confirm.getByRole('button', { name: 'Xóa' }).click()
  await expect(page.getByRole('radiogroup', { name: 'Mức kính ngữ với #general' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Threads', exact: true }).click()
  await expect(threadList(page).getByRole('button', { name: /Họp định kỳ hằng tuần/ })).toHaveCount(0)
})

test('glossary: the team file is chosen and dropped from the Glossary tab', async ({ page }) => {
  await openTab(page, 'Glossary')
  await expect(page.getByText(/Glossary chung CustomerX, 3 thuật ngữ/)).toBeVisible()
  await page.getByRole('button', { name: 'Bỏ dùng' }).click()
  await expect(page.getByRole('cell', { name: '受入テスト' })).toHaveCount(0)
  await expect(page.getByRole('radiogroup', { name: 'Lọc phạm vi' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Chọn file...' }).click()
  await expect(page.getByRole('cell', { name: '受入テスト' })).toBeVisible()

  // Settings no longer has it.
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click()
  await expect(page.getByText('Glossary chung')).toHaveCount(0)
})

test('settings: history retention and the two-step wipe', async ({ page }) => {
  await openTab(page, 'Cài đặt')
  const keep = page.getByRole('radiogroup', { name: 'Giữ lịch sử' })
  await keep.getByRole('radio', { name: '6 tháng' }).click()
  await expect(keep.getByRole('radio', { name: '6 tháng' })).toHaveAttribute('aria-checked', 'true')

  await page.getByRole('button', { name: 'Xóa dữ liệu...' }).click()
  await page.getByRole('button', { name: 'Hủy' }).click()
  await expect(page.getByRole('button', { name: 'Xác nhận xóa' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Xóa dữ liệu...' }).click()
  await page.getByRole('button', { name: 'Xác nhận xóa' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'đã xóa dữ liệu' })).toBeVisible()
})

test('settings: checking finds a new version and installing shows progress', async ({ page }) => {
  await openTab(page, 'Cài đặt')
  await page.getByRole('button', { name: 'Kiểm tra ngay' }).click()
  await expect(page.getByText('Có phiên bản mới 0.2.0')).toBeVisible()
  await page.getByRole('button', { name: 'Cập nhật và khởi động lại' }).click()
  await expect(page.getByText(/Đang tải/)).toBeVisible()
  await expect(page.getByText('Đang cài, app sẽ tự mở lại…')).toBeVisible()

  // Other tabs show the waiting update as a banner, which can be put off.
  await page.getByRole('button', { name: 'Threads', exact: true }).click()
  await expect(page.getByText('Có phiên bản mới 0.2.0')).toBeVisible()
})

test('settings: set up ChatGPT in its card, star a model, and make it the default', async ({ page }) => {
  await openTab(page, 'Cài đặt')
  const card = page.getByRole('region', { name: 'ChatGPT' })
  await card.getByRole('button', { name: /ChatGPT/ }).first().click()
  const key = card.getByRole('textbox', { name: 'API key ChatGPT' })
  await key.fill('sk-test')
  await card.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(key).toHaveValue('')
  await card.getByRole('button', { name: 'Dịch thử' }).click()
  await expect(card.getByText(/Chữ đầu tiên sau/)).toBeVisible()

  // A favourite shows up in the quick switcher; the default model cannot be un-starred.
  await card.getByRole('button', { name: 'Thêm gpt-6-astra vào menu chọn nhanh' }).click()
  await expect(card.getByRole('button', { name: 'Bỏ gpt-6-astra khỏi menu chọn nhanh' })).toHaveAttribute('aria-pressed', 'true')

  await card.getByRole('button', { name: 'Dùng ChatGPT' }).click()
  await expect(card.getByText('Đang dùng')).toBeVisible()
  await expect(page.getByText('ChatGPT · GPT-5.6 Luna')).toBeVisible()
})
