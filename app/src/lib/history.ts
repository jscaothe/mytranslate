// The translation history kept by the Rust side (history.rs). Threads are filed and picked there, out of sight.
import { invoke } from '@tauri-apps/api/core'

export async function setFeedback(messageId: number, bad: boolean): Promise<void> {
  await invoke('history_feedback', { messageId, bad })
}
