import { expect, test, type Page } from '@playwright/test'

// The main window: Glossary (terms and people), writing skills and Settings, with the prototype's sample data.

const openTab = async (page: Page, tab: string) => {
  await page.getByRole('button', { name: 'Cửa sổ chính' }).click()
  await page.getByRole('button', { name: tab, exact: true }).click()
}


test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('the main window has the Glossary, writing skills and Settings: threads and contacts are kept out of sight', async ({ page }) => {
  await page.getByRole('button', { name: 'Cửa sổ chính' }).click()
  const nav = page.getByRole('navigation', { name: 'Điều hướng' })
  await expect(nav.getByRole('button')).toHaveText(['', '', ''])
  await expect(nav.getByRole('button', { name: 'Glossary' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('button', { name: 'Kỹ năng viết' })).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Cài đặt' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Threads', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Người liên hệ', exact: true })).toHaveCount(0)
})

test('glossary: a person is added with a prompt for the AI, filtered by kind and edited in place', async ({ page }) => {
  await openTab(page, 'Glossary')
  const add = page.getByRole('form', { name: 'Thêm vào glossary' })
  await add.getByRole('radiogroup', { name: 'Loại' }).getByRole('radio', { name: 'Người' }).click()
  await expect(add.getByText(/khi tên người này có trong tin nhắn/)).toBeVisible()
  await add.getByRole('textbox', { name: 'Tên tiếng Nhật' }).fill('佐藤')
  await add.getByRole('textbox', { name: 'Tên tiếng Việt' }).fill('Sato')
  await add.getByRole('textbox', { name: 'Mô tả cho AI' }).fill('Trưởng nhóm phía khách, gọi là 佐藤さん.')
  await add.getByRole('button', { name: 'Thêm' }).click()

  const row = page.getByRole('row').filter({ hasText: '佐藤' })
  await expect(row.getByRole('img', { name: 'Người' })).toBeVisible()
  await expect(row).toContainText('Trưởng nhóm phía khách')

  // People only: the sample people and the new one, no terms.
  const kinds = page.getByRole('radiogroup', { name: 'Lọc loại' })
  await kinds.getByRole('radio', { name: 'Người' }).click()
  await expect(page.getByRole('row').filter({ hasText: '佐藤' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: '田中' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'デプロイ' })).toHaveCount(0)
  await kinds.getByRole('radio', { name: 'Thuật ngữ' }).click()
  await expect(page.getByRole('row').filter({ hasText: '佐藤' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'デプロイ' })).toBeVisible()
  await kinds.getByRole('radio', { name: 'Tất cả' }).click()

  // Edit the prompt: Enter saves, Escape leaves the row as it was.
  await row.hover()
  await row.getByRole('button', { name: 'Sửa' }).click()
  // While edited, the row's text is in its fields.
  const table = page.getByRole('table')
  const prompt = table.getByRole('textbox', { name: 'Mô tả cho AI' })
  await prompt.fill('Trưởng nhóm phía khách, gọi là 佐藤様, viết trang trọng.')
  await prompt.press('Enter')
  await expect(row).toContainText('gọi là 佐藤様, viết trang trọng')
  await expect(table.getByRole('textbox')).toHaveCount(0)

  await row.hover()
  await row.getByRole('button', { name: 'Sửa' }).click()
  await table.getByRole('textbox', { name: 'Tên tiếng Việt' }).fill('Không lưu')
  await table.getByRole('textbox', { name: 'Tên tiếng Việt' }).press('Escape')
  await expect(row).toContainText('Sato')
  await expect(row).not.toContainText('Không lưu')
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
  await expect(keep.getByRole('radio', { name: '3 tháng' })).toHaveAttribute('aria-checked', 'true')
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
  await page.getByRole('button', { name: 'Glossary', exact: true }).click()
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

test('writing: what the checks found, per language and period, and advice from the AI', async ({ page }) => {
  await openTab(page, 'Kỹ năng viết')
  // A Vietnamese user checks the Japanese they send first.
  const language = page.getByRole('radiogroup', { name: 'Ngôn ngữ của câu' })
  await expect(language.getByRole('radio', { name: 'Tiếng Nhật' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Câu đã kiểm tra')).toBeVisible()
  const kinds = page.getByRole('list', { name: 'Lỗi theo loại' })
  await expect(kinds.getByRole('listitem').first()).toContainText('Kính ngữ')
  const repeated = page.locator('section', { has: page.getByRole('heading', { name: 'Lỗi lặp lại' }) })
  await expect(repeated.getByRole('listitem').first()).toContainText('確認してください')
  await expect(repeated.getByRole('listitem').first()).toContainText('lần')

  // Vietnamese: politeness is about forms of address.
  await language.getByRole('radio', { name: 'Tiếng Việt' }).click()
  await expect(repeated.getByRole('listitem').first()).toContainText('ko')
  await expect(page.getByText('Xưng hô').first()).toBeVisible()

  // A shorter period leaves out older checks.
  const period = page.getByRole('radiogroup', { name: 'Khoảng thời gian' })
  const recent = page.locator('section', { has: page.getByRole('heading', { name: 'Gần đây' }) }).getByRole('listitem')
  await period.getByRole('radio', { name: 'Tất cả' }).click()
  const all = await recent.count()
  await period.getByRole('radio', { name: '30 ngày' }).click()
  await expect(recent).not.toHaveCount(all)

  await page.getByRole('button', { name: 'Phân tích lỗi của tôi' }).click()
  await expect(page.getByText('Viết đủ từ, không viết tắt')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Làm mới' })).toBeVisible()
})
