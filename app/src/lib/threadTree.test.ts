import { describe, expect, it } from 'vitest'
import type { Conversation, Thread } from '../types'
import { threadTree } from './threadTree'

const conv = (id: string, app: Conversation['app'], org: string, workspace: string, name: string): Conversation => ({
  id,
  app,
  org,
  workspace,
  name,
  keigo: '',
  note: '',
})

const thread = (id: string, conversationId: string, pinned = false): Thread => ({
  id,
  conversationId,
  title: id,
  summary: '',
  lastActive: '',
  pinned,
  messages: [],
})

describe('threadTree', () => {
  it('groups Slack by workspace and Teams by team, keeping the order of the conversations', () => {
    const tree = threadTree(
      [
        conv('a', 'teams', 'acme.example', 'ALPHA', 'General'),
        conv('b', 'slack', '', 'CustomerX', 'dev-qa'),
        conv('c', 'teams', 'acme.example', 'ALPHA', 'Random'),
        conv('d', 'slack', '', 'CustomerY', 'general'),
        conv('e', 'slack', '', 'CustomerX', 'general'),
        conv('f', 'teams', 'acme.example', '', 'Tanaka'),
      ],
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => thread(`t-${id}`, id)),
    )
    expect(tree.map((a) => a.app)).toEqual(['teams', 'slack'])
    const [teams, slack] = tree
    expect(teams.spaces.map((s) => [s.name, s.chats, s.channels.map((c) => c.conversation.name)])).toEqual([
      ['ALPHA', false, ['General', 'Random']],
      ['', true, ['Tanaka']],
    ])
    expect(slack.spaces.map((s) => [s.name, s.channels.map((c) => c.conversation.name)])).toEqual([
      ['CustomerX', ['dev-qa', 'general']],
      ['CustomerY', ['general']],
    ])
    // One organisation only: no need to name it.
    expect(teams.spaces[0].org).toBe('')
  })

  it('tells the same team name in two organisations apart and names them', () => {
    const tree = threadTree(
      [conv('a', 'teams', 'acme.example', 'ALPHA', 'General'), conv('b', 'teams', 'ACMECLIENT', 'ALPHA', 'General')],
      [thread('t-a', 'a'), thread('t-b', 'b')],
    )
    expect(tree[0].spaces.map((s) => [s.name, s.org])).toEqual([
      ['ALPHA', 'acme.example'],
      ['ALPHA', 'ACMECLIENT'],
    ])
  })

  it('leaves out conversations without threads and puts the pinned thread first', () => {
    const tree = threadTree(
      [conv('a', 'slack', '', 'X', 'dev-qa'), conv('b', 'slack', '', 'X', 'empty')],
      [thread('old', 'a'), thread('pinned', 'a', true)],
    )
    expect(tree[0].spaces[0].channels.map((c) => c.threads.map((t) => t.id))).toEqual([['pinned', 'old']])
  })
})
