import type { AppRef } from '../store'
import type { ChatChannel, Conversation, GlossaryTerm, Thread } from '../types'

export const conversations: Conversation[] = [
  { id: 'c-devqa', app: 'slack', workspace: 'CustomerX', name: '#dev-qa', keigo: '', note: 'Tanaka là PM, Suzuki là tester phía khách.' },
  { id: 'c-general', app: 'slack', workspace: 'CustomerX', name: '#general', keigo: 'polite', note: '' },
  { id: 'c-tanaka', app: 'teams', workspace: 'CustomerX', name: 'Tanaka Taro', keigo: 'formal', note: 'PM phía khách, gọi là 田中様.' },
]

export const initialThreads: Thread[] = [
  {
    id: 't-login',
    conversationId: 'c-devqa',
    title: 'Lỗi đăng nhập màn hình A',
    summary:
      'Khách báo lỗi đăng nhập sau đợt deploy ngày 8/10. Team đã sửa lỗi session và deploy lại, đang chờ khách xác nhận.',
    lastActive: '2 phút',
    pinned: false,
    messages: [
      {
        id: 'm1',
        author: 'other',
        name: 'Tanaka',
        time: '10:02',
        ja: 'ログイン画面でエラーが出ています。先ほどの修正は反映済みでしょうか？',
        vi: 'Màn hình đăng nhập đang báo lỗi. Bản sửa lúc nãy đã được áp dụng chưa ạ?',
      },
      {
        id: 'm2',
        author: 'me',
        name: 'Tôi',
        time: '10:05',
        ja: '先ほどの修正はデプロイ済みです。お手数ですが、再度ご確認いただけますでしょうか。',
        vi: 'Bản sửa lúc nãy đã được deploy. Xin lỗi đã làm phiền, anh có thể kiểm tra lại được không ạ?',
      },
    ],
  },
  {
    id: 't-release',
    conversationId: 'c-devqa',
    title: 'Lịch release tháng 11',
    summary: 'Khách muốn trao đổi lịch release tháng 11. Chưa chốt ngày, cần gửi đề xuất trong tuần tới.',
    lastActive: 'hôm qua',
    pinned: false,
    messages: [
      {
        id: 'm3',
        author: 'other',
        name: 'Tanaka',
        time: 'Hôm qua 16:40',
        ja: '11月のリリース日程について、候補日をいくつかいただけますか。',
        vi: 'Về lịch release tháng 11, bên em có thể gửi vài ngày đề xuất được không?',
      },
    ],
  },
  {
    id: 't-payment',
    conversationId: 'c-devqa',
    title: 'Câu hỏi về API thanh toán',
    summary: 'Khách hỏi về timeout của API thanh toán. Đã trả lời là 30 giây.',
    lastActive: '3 ngày',
    pinned: false,
    messages: [
      {
        id: 'm4',
        author: 'other',
        name: 'Suzuki',
        time: '06/10 14:12',
        ja: '決済APIのタイムアウトは何秒に設定されていますか。',
        vi: 'Timeout của API thanh toán đang được đặt là bao nhiêu giây?',
      },
      {
        id: 'm5',
        author: 'me',
        name: 'Tôi',
        time: '06/10 14:30',
        ja: '現在30秒に設定しております。',
        vi: 'Hiện đang được đặt là 30 giây.',
      },
    ],
  },
  {
    id: 't-meeting',
    conversationId: 'c-general',
    title: 'Họp định kỳ hằng tuần',
    summary: 'Họp định kỳ lúc 15:00 mỗi thứ Năm.',
    lastActive: '3 ngày',
    pinned: false,
    messages: [
      {
        id: 'm6',
        author: 'other',
        name: 'Sato',
        time: '06/10 09:01',
        ja: '本日15時から定例会議を行います。',
        vi: 'Hôm nay họp định kỳ từ 15 giờ.',
      },
    ],
  },
  {
    id: 't-specb',
    conversationId: 'c-tanaka',
    title: 'Spec màn hình B',
    summary: 'Thảo luận về validate form ở màn hình B. Khách sẽ gửi spec bản cập nhật.',
    lastActive: '5 ngày',
    pinned: false,
    messages: [
      {
        id: 'm7',
        author: 'other',
        name: 'Tanaka Taro',
        time: '04/10 11:20',
        ja: '画面Bの入力チェック仕様を更新しましたので、ご確認ください。',
        vi: 'Tôi đã cập nhật spec kiểm tra nhập liệu của màn hình B, nhờ bên em xem giúp.',
      },
    ],
  },
]

export const chatChannels: Record<'slack' | 'teams', ChatChannel[]> = {
  slack: [
    {
      id: 'devqa',
      conversationId: 'c-devqa',
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
      conversationId: 'c-general',
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
      conversationId: 'c-tanaka',
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
}

export const initialGlossary: GlossaryTerm[] = [
  { id: 'g1', ja: '予約確定画面', vi: 'màn hình xác nhận đặt phòng', note: 'Không dịch là "booking confirm"', scope: 'project' },
  { id: 'g2', ja: '受入テスト', vi: 'UAT', note: '', scope: 'project' },
  { id: 'g3', ja: '定例会議', vi: 'họp định kỳ', note: 'Thứ Năm 15:00', scope: 'project' },
  { id: 'g4', ja: '反映', vi: 'áp dụng (lên môi trường)', note: 'Trong ngữ cảnh deploy', scope: 'personal' },
  { id: 'g5', ja: 'デプロイ', vi: 'deploy', note: 'Giữ nguyên tiếng Anh', scope: 'personal' },
]


export const keigoLabels: Record<'casual' | 'polite' | 'formal', string> = {
  casual: 'Thân mật',
  polite: 'Lịch sự',
  formal: 'Trang trọng',
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
