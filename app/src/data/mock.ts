import type { Lang } from '../lib/i18n'
import type { AppRef } from '../store'
import type { ChatChannel, GlossaryTerm, Keigo } from '../types'

/** The browser prototype's sample data, as seen by a user of each language. */
export interface MockData {
  chatChannels: Record<'slack' | 'teams', ChatChannel[]>
  glossary: GlossaryTerm[]
  /** The user's name in the simulated chat. */
  me: string
  /** People in the simulated Slack's direct messages. */
  directMessages: string[]
}

/** A Vietnamese team member chatting with the Japanese client. */
const vietnamese: MockData = {
  me: 'Nguyễn Văn A',
  directMessages: ['Tanaka', 'Suzuki'],
  chatChannels: {
    slack: [
      {
        id: 'devqa',
        label: 'dev-qa',
        kind: 'channel',
        messages: [
          {
            id: 's1',
            author: 'Tanaka',
            me: false,
            time: '10:02',
            text: 'ログイン画面でエラーが出ています。先ほどの修正は反映済みでしょうか？',
          },
          {
            id: 's2',
            author: 'Nguyễn Văn A',
            me: true,
            time: '10:05',
            text: '先ほどの修正はデプロイ済みです。お手数ですが、再度ご確認いただけますでしょうか。',
          },
          {
            id: 's3',
            author: 'Suzuki',
            me: false,
            time: '10:20',
            text: '確認しました。問題なく動作しています。ありがとうございます。',
          },
          {
            id: 's4',
            author: 'Tanaka',
            me: false,
            time: '11:15',
            text: '別件ですが、11月のリリース日程について相談させてください。来週の水曜日は可能でしょうか。',
          },
        ],
      },
      {
        id: 'general',
        label: 'general',
        kind: 'channel',
        messages: [
          {
            id: 'g1',
            author: 'Sato',
            me: false,
            time: '09:00',
            text: 'おはようございます。本日もよろしくお願いいたします。',
          },
          {
            id: 'g2',
            author: 'Sato',
            me: false,
            time: '09:01',
            text: '本日15時から定例会議を行います。議題は事前に共有いたします。',
          },
        ],
      },
    ],
    teams: [
      {
        id: 'tanaka',
        label: 'Tanaka Taro',
        kind: 'dm',
        messages: [
          {
            id: 'tm1',
            author: 'Tanaka Taro',
            me: false,
            time: '11:20',
            text: '画面Bの入力チェック仕様を更新しましたので、ご確認ください。不明点があれば明日までにご連絡ください。',
          },
        ],
      },
    ],
  },
  glossary: [
    { id: 'g1', ja: '予約確定画面', vi: 'màn hình xác nhận đặt phòng', note: 'Không dịch là "booking confirm"', kind: 'term', scope: 'project' },
    { id: 'g2', ja: '受入テスト', vi: 'UAT', note: '', kind: 'term', scope: 'project' },
    { id: 'g3', ja: '定例会議', vi: 'họp định kỳ', note: 'Thứ Năm 15:00', kind: 'term', scope: 'project' },
    { id: 'g4', ja: '反映', vi: 'áp dụng (lên môi trường)', note: 'Trong ngữ cảnh deploy', kind: 'term', scope: 'personal' },
    { id: 'g5', ja: 'デプロイ', vi: 'deploy', note: 'Giữ nguyên tiếng Anh', kind: 'term', scope: 'personal' },
    { id: 'p1', ja: '田中', vi: 'Tanaka', note: 'PM phía khách. Gọi là 田中様, viết trang trọng (尊敬語).', kind: 'person', scope: 'personal' },
    { id: 'p2', ja: '鈴木', vi: 'Suzuki', note: 'Tester phía khách, gọi là 鈴木さん.', kind: 'person', scope: 'personal' },
  ],
}

/** A Japanese PM at the client chatting with the Vietnamese development team. */
const japanese: MockData = {
  me: 'Tanaka Taro',
  directMessages: ['Nguyễn Văn A', 'Trần Minh'],
  chatChannels: {
    slack: [
      {
        id: 'devqa',
        label: 'dev-qa',
        kind: 'channel',
        messages: [
          {
            id: 's1',
            author: 'Nguyễn Văn A',
            me: false,
            time: '10:02',
            text: 'Em đã sửa lỗi màn hình đăng nhập và deploy lên staging rồi ạ. Anh kiểm tra giúp em nhé.',
          },
          {
            id: 's2',
            author: 'Tanaka Taro',
            me: true,
            time: '10:05',
            text: 'Tôi đã kiểm tra, không còn lỗi nữa. Cảm ơn em.',
          },
          {
            id: 's3',
            author: 'Trần Minh',
            me: false,
            time: '10:20',
            text: 'Em đã test lại toàn bộ luồng đăng nhập, không có vấn đề gì ạ.',
          },
          {
            id: 's4',
            author: 'Nguyễn Văn A',
            me: false,
            time: '11:15',
            text: 'Về lịch release tháng 11, bên em đề xuất thứ Tư tuần sau. Anh thấy có được không ạ?',
          },
        ],
      },
      {
        id: 'general',
        label: 'general',
        kind: 'channel',
        messages: [
          {
            id: 'g1',
            author: 'Nguyễn Văn A',
            me: false,
            time: '09:00',
            text: 'Chào buổi sáng mọi người. Hôm nay họp định kỳ lúc 15 giờ ạ.',
          },
        ],
      },
    ],
    teams: [
      {
        id: 'nguyen',
        label: 'Nguyễn Văn A',
        kind: 'dm',
        messages: [
          {
            id: 'tm1',
            author: 'Nguyễn Văn A',
            me: false,
            time: '11:20',
            text: 'Em đã cập nhật spec màn hình B theo góp ý của anh. Anh xem giúp em trước ngày mai nhé.',
          },
        ],
      },
    ],
  },
  glossary: [
    { id: 'g1', ja: '予約確定画面', vi: 'màn hình xác nhận đặt phòng', note: '「booking confirm」とは訳さない', kind: 'term', scope: 'project' },
    { id: 'g2', ja: '受入テスト', vi: 'UAT', note: '', kind: 'term', scope: 'project' },
    { id: 'g3', ja: '定例会議', vi: 'họp định kỳ', note: '木曜15時', kind: 'term', scope: 'project' },
    { id: 'g4', ja: '本番環境', vi: 'môi trường production', note: '', kind: 'term', scope: 'personal' },
    { id: 'g5', ja: 'デプロイ', vi: 'deploy', note: '英語のまま', kind: 'term', scope: 'personal' },
    { id: 'p1', ja: 'グエン', vi: 'Nguyễn Văn A', note: 'ベトナム側の開発リーダー。「anh」と呼ぶ。', kind: 'person', scope: 'personal' },
    { id: 'p2', ja: 'チャン', vi: 'Trần Minh', note: 'テスター。「em」と呼ぶ。', kind: 'person', scope: 'personal' },
  ],
}

export function mockData(lang: Lang): MockData {
  return lang === 'ja' ? japanese : vietnamese
}

export function keigoLabel(keigo: Keigo, lang: Lang): string {
  const labels: Record<Keigo, [string, string]> = {
    casual: ['Thân mật', 'カジュアル'],
    polite: ['Lịch sự', '丁寧'],
    formal: ['Trang trọng', 'とても丁寧'],
  }
  return labels[keigo][lang === 'ja' ? 1 : 0]
}

/** What the real app would list from the running processes (with a window) on this PC. */
export const runningApps: AppRef[] = [
  { exe: 'ms-teams.exe', name: 'Microsoft Teams' },
  { exe: 'slack.exe', name: 'Slack' },
  { exe: 'chrome.exe', name: 'Google Chrome' },
  { exe: 'msedge.exe', name: 'Microsoft Edge' },
  { exe: 'olk.exe', name: 'Outlook' },
  { exe: 'EXCEL.EXE', name: 'Microsoft Excel' },
  { exe: 'Zalo.exe', name: 'Zalo' },
  { exe: 'Chatwork.exe', name: 'Chatwork' },
  { exe: 'Code.exe', name: 'Visual Studio Code' },
]
