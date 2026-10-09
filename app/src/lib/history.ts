// The translation history kept by the Rust side (history.rs), mapped to the shapes the screens use.
import { invoke } from '@tauri-apps/api/core'
import type { Conversation, Thread, ThreadMessage } from '../types'

interface ConversationRow {
  id: number
  app: string
  name: string
  workspace: string
  lastActive: number
}

interface ThreadRow {
  id: number
  conversationId: number
  title: string
  pinned: boolean
  lastActive: number
}

interface MessageRow {
  id: number
  threadId: number
  direction: 'ja_vi' | 'vi_ja' | 'review_ja'
  source: string
  result: string
  back: string
  createdAt: number
}

export async function loadHistory(): Promise<{ conversations: Conversation[]; threads: Thread[] }> {
  const snap = await invoke<{ conversations: ConversationRow[]; threads: ThreadRow[] }>('history_snapshot')
  return {
    conversations: snap.conversations.map((c) => ({
      id: String(c.id),
      app: c.app === 'slack' || c.app === 'teams' ? c.app : 'other',
      workspace: c.workspace,
      name: c.name,
    })),
    threads: snap.threads.map((t) => ({
      id: String(t.id),
      conversationId: String(t.conversationId),
      title: t.title,
      summary: '',
      lastActive: relativeTime(t.lastActive),
      pinned: t.pinned,
      messages: [],
    })),
  }
}

/** Messages of one thread, as chat bubbles: the client's side on the left, the user's on the right. */
export async function loadMessages(threadId: string): Promise<ThreadMessage[]> {
  const rows = await invoke<MessageRow[]>('history_messages', { threadId: Number(threadId) })
  return rows.map((m) => {
    const fromClient = m.direction === 'ja_vi'
    return {
      id: String(m.id),
      author: fromClient ? 'other' : 'me',
      name: fromClient ? 'Khách' : 'Tôi',
      time: new Date(m.createdAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      // Japanese on top, Vietnamese below, whichever side was typed.
      ja: fromClient ? m.source : m.result,
      vi: fromClient ? m.result : m.direction === 'vi_ja' ? m.source : m.back,
    }
  })
}

export async function renameThread(threadId: string, title: string): Promise<void> {
  await invoke('history_rename_thread', { threadId: Number(threadId), title })
}

/** "vừa xong", "5 phút", "hôm qua"... */
export function relativeTime(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return 'vừa xong'
  if (minutes < 60) return `${minutes} phút`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} giờ`
  const days = Math.round(hours / 24)
  return days === 1 ? 'hôm qua' : `${days} ngày`
}
