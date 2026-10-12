// The translation history kept by the Rust side (history.rs), mapped to the shapes the screens use.
import { invoke } from '@tauri-apps/api/core'
import { locale, pick, type Lang } from './i18n'
import type { Conversation, Keigo, Thread, ThreadMessage } from '../types'

interface ConversationRow {
  id: number
  app: string
  name: string
  workspace: string
  org: string
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
  /** Written by the user, not by the other side. */
  mine: boolean
}

export async function loadHistory(lang: Lang): Promise<{ conversations: Conversation[]; threads: Thread[] }> {
  const snap = await invoke<{ conversations: ConversationRow[]; threads: ThreadRow[] }>('history_snapshot')
  return {
    conversations: snap.conversations.map((c) => ({
      id: String(c.id),
      app: c.app === 'slack' || c.app === 'teams' ? c.app : 'other',
      workspace: c.workspace,
      org: c.org,
      name: c.name,
      keigo: c.keigo === 'casual' || c.keigo === 'polite' || c.keigo === 'formal' ? c.keigo : '',
      note: c.note,
    })),
    threads: snap.threads.map((t) => toThread(t, lang)),
  }
}

function toThread(t: ThreadRow, lang: Lang): Thread {
  return {
    id: String(t.id),
    conversationId: String(t.conversationId),
    title: t.title,
    summary: t.summary,
    summaryStale: t.summaryStale,
    lastActive: relativeTime(t.lastActive, lang),
    pinned: t.pinned,
    archived: t.archived,
    messages: [],
  }
}

/** Messages of one thread, as chat bubbles: the other side on the left, the user's on the right. */
export async function loadMessages(threadId: string, lang: Lang): Promise<ThreadMessage[]> {
  const rows = await invoke<MessageRow[]>('history_messages', { threadId: Number(threadId) })
  return rows.map((m) => ({
    id: String(m.id),
    author: m.mine ? 'me' : 'other',
    name: m.mine ? pick(lang, 'Tôi', '自分') : pick(lang, 'Khách', '相手'),
    time: new Date(m.createdAt).toLocaleString(locale(lang), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    // Both sides, whichever was typed.
    ja: m.direction === 'ja_vi' ? m.source : m.result,
    vi: m.direction === 'ja_vi' ? m.result : m.direction === 'vi_ja' ? m.source : m.back,
  }))
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

/** The AI summarizes the thread in the user's language; the summary is stored with it. */
export async function summarizeThread(threadId: string, lang: Lang): Promise<Thread> {
  return toThread(await invoke<ThreadRow>('thread_summarize', { threadId: Number(threadId) }), lang)
}

/** Without `note`, the stored note is kept. */
export async function updateConversation(conversationId: string, keigo: Keigo | '', note?: string): Promise<void> {
  await invoke('conversation_update', { conversationId: Number(conversationId), keigo, note })
}

/** A reply in the other side's language, with its meaning in the user's. */
export interface Reply {
  text: string
  meaning: string
}

export async function suggestReplies(args: { text: string; keigo: Keigo; conversationId: number | null; threadId: number | null }): Promise<Reply[]> {
  return invoke<Reply[]>('suggest_replies', args)
}

/** "vừa xong", "5 phút", "hôm qua"... or "たった今", "5分前", "昨日"... */
export function relativeTime(ms: number, lang: Lang): string {
  const minutes = Math.round((Date.now() - ms) / 60000)
  if (minutes < 1) return pick(lang, 'vừa xong', 'たった今')
  if (minutes < 60) return pick(lang, `${minutes} phút`, `${minutes}分前`)
  const hours = Math.round(minutes / 60)
  if (hours < 24) return pick(lang, `${hours} giờ`, `${hours}時間前`)
  const days = Math.round(hours / 24)
  if (days === 1) return pick(lang, 'hôm qua', '昨日')
  return pick(lang, `${days} ngày`, `${days}日前`)
}
