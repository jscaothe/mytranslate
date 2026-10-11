// The translation history kept by the Rust side (history.rs), mapped to the shapes the screens use.
import { invoke } from '@tauri-apps/api/core'
import type { Conversation, Keigo, Thread, ThreadMessage } from '../types'

interface ConversationRow {
  id: number
  app: string
  name: string
  workspace: string
  lastActive: number
  keigo: string
  note: string
}

interface ThreadRow {
  id: number
  conversationId: number
  title: string
  pinned: boolean
  lastActive: number
  archived: boolean
  summary: string
  summaryStale: boolean
  messageCount: number
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
      keigo: c.keigo === 'casual' || c.keigo === 'polite' || c.keigo === 'formal' ? c.keigo : '',
      note: c.note,
    })),
    threads: snap.threads.map(toThread),
  }
}

function toThread(t: ThreadRow): Thread {
  return {
    id: String(t.id),
    conversationId: String(t.conversationId),
    title: t.title,
    summary: t.summary,
    summaryStale: t.summaryStale,
    lastActive: relativeTime(t.lastActive),
    pinned: t.pinned,
    archived: t.archived,
    messages: [],
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

/** Ids of threads whose title, summary or messages contain the query. */
export async function searchThreads(query: string): Promise<Set<string>> {
  const ids = await invoke<number[]>('history_search', { query })
  return new Set(ids.map(String))
}

export async function setFeedback(messageId: number, bad: boolean): Promise<void> {
  await invoke('history_feedback', { messageId, bad })
}

export async function setPinned(threadId: string, pinned: boolean): Promise<void> {
  await invoke('history_set_pinned', { threadId: Number(threadId), pinned })
}

export async function setArchived(threadId: string, archived: boolean): Promise<void> {
  await invoke('history_set_archived', { threadId: Number(threadId), archived })
}

/** Deletes the thread and its messages for good. */
export async function deleteThread(threadId: string): Promise<void> {
  await invoke('history_delete_thread', { threadId: Number(threadId) })
}

/** Deletes the conversation with its keigo, note, threads and messages. */
export async function deleteConversation(conversationId: string): Promise<void> {
  await invoke('history_delete_conversation', { conversationId: Number(conversationId) })
}

export async function mergeThreads(from: string, into: string): Promise<void> {
  await invoke('history_merge', { from: Number(from), into: Number(into) })
}

/** Asks where to save; resolves to the file written, or `null` when the user cancelled. */
export async function exportThread(threadId: string): Promise<string | null> {
  return invoke<string | null>('history_export', { threadId: Number(threadId) })
}

/** Claude summarizes the thread in Vietnamese; the summary is stored with it. */
export async function summarizeThread(threadId: string): Promise<Thread> {
  return toThread(await invoke<ThreadRow>('thread_summarize', { threadId: Number(threadId) }))
}

/** Without `note`, the stored note is kept. */
export async function updateConversation(conversationId: string, keigo: Keigo | '', note?: string): Promise<void> {
  await invoke('conversation_update', { conversationId: Number(conversationId), keigo, note })
}

export interface Reply {
  ja: string
  vi: string
}

export async function suggestReplies(args: { text: string; keigo: Keigo; conversationId: number | null; threadId: number | null }): Promise<Reply[]> {
  return invoke<Reply[]>('suggest_replies', args)
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
