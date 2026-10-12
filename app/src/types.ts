export type ChatApp = 'slack' | 'teams'

export type Direction = 'ja_vi' | 'vi_ja' | 'review_ja'

export type Keigo = 'casual' | 'polite' | 'formal'

/** Simulated backend condition, chosen from the prototype toolbar. */
export type Scenario = 'normal' | 'no_claude' | 'not_logged_in' | 'quota' | 'network'

export interface GlossaryTerm {
  id: string
  ja: string
  vi: string
  /** For a person: who they are, how to address them, which keigo to use. */
  note: string
  /** A person is sent to the AI when their name is in the message, the recent thread or the chat's name. */
  kind: 'term' | 'person'
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
