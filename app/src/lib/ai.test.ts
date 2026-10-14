import { describe, expect, it } from 'vitest'
import { choiceLabel, modelField, modelName } from './ai'

describe('modelName', () => {
  it('names Claude models by family and version, without a release date', () => {
    expect(modelName('anthropic', 'claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(modelName('anthropic', 'claude-opus-5')).toBe('Opus 5')
    expect(modelName('anthropic', 'claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  })

  it('keeps the other vendors as before', () => {
    expect(modelName('claude', 'haiku')).toBe('Haiku')
    expect(modelName('openai', 'gpt-5.6-luna')).toBe('GPT-5.6 Luna')
    expect(modelName('gemini', 'gemini-3.6-flash')).toBe('Gemini 3.6 Flash')
  })
})

describe('Claude through an API key', () => {
  it('has its own model setting and is told apart from Claude Code', () => {
    expect(modelField('anthropic')).toBe('anthropicModel')
    expect(modelField('claude')).toBe('model')
    expect(choiceLabel({ provider: 'anthropic', model: 'claude-sonnet-5-5' })).toBe('Claude API · Sonnet 5.5')
    expect(choiceLabel({ provider: 'claude', model: 'sonnet' })).toBe('Claude Sonnet')
  })
})
