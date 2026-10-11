export type ChatApp = 'slack' | 'teams'

export type Direction = 'ja_vi' | 'vi_ja' | 'review_ja'

export type Keigo = 'casual' | 'polite' | 'formal'

export type Confidence = 'high' | 'medium' | 'low'

/** Simulated backend condition, chosen from the prototype toolbar. */
export type Scenario = 'normal' | 'no_claude' | 'not_logged_in' | 'quota' | 'network' | 'uncertain_thread'

export interface Conversation {
  id: string
  app: ChatApp | 'other'
  workspace: string
  name: string
  /** Keigo to write in for this conversation; `''` uses the default from the settings. */
  keigo: Keigo | ''
  /** Who the people here are (names, roles, how to address them); sent with each translation. */
  note: string
}

export interface ThreadMessage {
  id: string
  author: 'me' | 'other'
  name: string
  time: string
  ja: string
  vi: string
}

export interface Thread {
  id: string
  conversationId: string
  title: string
  summary: string
  lastActive: string
  /** Every new message of the conversation goes into the pinned thread. */
  pinned: boolean
  /** Hidden from the list and never guessed for new messages. */
  archived?: boolean
  /** New messages arrived after the summary was made. */
  summaryStale?: boolean
  messages: ThreadMessage[]
}

export interface GlossaryTerm {
  id: string
  ja: string
  vi: string
  note: string
  scope: 'personal' | 'project'
}

export interface ChatMessage {
  id: string
  author: string
  me: boolean
  time: string
  text: string
}

export interface ChatChannel {
  id: string
  /** Conversation id used for thread detection. */
  conversationId: string
  label: string
  kind: 'channel' | 'dm'
  messages: ChatMessage[]
}

export interface Note {
  kind: 'keigo' | 'context' | 'glossary'
  text: string
}

export interface ReviewIssue {
  /** Usually Ngữ pháp, Kính ngữ, Tự nhiên or Chính tả, as named by Claude. */
  kind: string
  span: string
  text: string
}

export interface TranslationResult {
  translation: string
  backTranslation?: string
  notes: Note[]
}

export interface DiffPart {
  text: string
  type: 'same' | 'del' | 'ins'
}

export interface ReviewResult {
  verdict: 'ok' | 'suggest' | 'error'
  issues: ReviewIssue[]
  /** Suggested sentence split into diff parts. */
  diff: DiffPart[]
  suggestion: string
  suggestionVi: string
}
