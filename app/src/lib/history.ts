// The translation history kept by the Rust side (history.rs). Threads are filed and picked there, out of sight.
import { invoke } from '@tauri-apps/api/core'
import type { Keigo } from '../types'

export async function setFeedback(messageId: number, bad: boolean): Promise<void> {
  await invoke('history_feedback', { messageId, bad })
}

/** A reply in the other side's language, with its meaning in the user's. */
export interface Reply {
  text: string
  meaning: string
}

export async function suggestReplies(args: { text: string; keigo: Keigo; conversationId: number | null; threadId: number | null }): Promise<Reply[]> {
  return invoke<Reply[]>('suggest_replies', args)
}
