export type ChatApp = 'slack' | 'teams'

/** `review_ja` and `review_vi` check a sentence the user wrote, in its own language, instead of translating it. */
export type Direction = 'ja_vi' | 'vi_ja' | 'review_ja' | 'review_vi'

export type Keigo = 'casual' | 'polite' | 'formal'

/** Simulated backend condition, chosen from the prototype toolbar. */
export type Scenario = 'normal' | 'no_claude' | 'not_logged_in' | 'quota' | 'network' | 'blocked'

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

/** What a review found wrong. `other` also covers lines the AI did not write in the expected form. */
export type IssueKind = 'grammar' | 'politeness' | 'natural' | 'spelling' | 'word_choice' | 'other'

export interface ReviewIssue {
  kind: IssueKind
  /** The words as written; empty when the issue is about the whole sentence. */
  wrong: string
  /** What to write instead; empty when there is no single replacement. */
  fix: string
  /** Why, in the user's language. */
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
