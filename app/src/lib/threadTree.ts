import type { Conversation, Thread } from '../types'

/** A channel or chat with its threads. */
export interface ChannelNode {
  key: string
  conversation: Conversation
  threads: Thread[]
}

/** A Slack workspace, a Teams team, or the chats of a Teams organisation (`chats`). */
export interface SpaceNode {
  key: string
  /** Workspace or team name; empty for Teams chats and for apps without workspaces. */
  name: string
  /** The Teams organisation, shown when the user is in more than one. */
  org: string
  chats: boolean
  channels: ChannelNode[]
}

export interface AppNode {
  key: string
  app: Conversation['app']
  spaces: SpaceNode[]
}

/**
 * Groups threads by app, then workspace or team, then channel. Everything keeps the order of `conversations`
 * (most recent first in the real app), and a conversation without threads is left out.
 */
export function threadTree(conversations: Conversation[], threads: Thread[]): AppNode[] {
  const teamsOrgs = new Set(conversations.filter((c) => c.app === 'teams').map((c) => c.org))
  const apps = new Map<string, AppNode>()
  for (const conversation of conversations) {
    const own = threads.filter((t) => t.conversationId === conversation.id)
    if (own.length === 0) continue
    const appKey = conversation.app
    let app = apps.get(appKey)
    if (!app) {
      app = { key: appKey, app: conversation.app, spaces: [] }
      apps.set(appKey, app)
    }
    const spaceKey = `${appKey}/${conversation.org}/${conversation.workspace}`
    let space = app.spaces.find((s) => s.key === spaceKey)
    if (!space) {
      space = {
        key: spaceKey,
        name: conversation.workspace,
        org: conversation.app === 'teams' && teamsOrgs.size > 1 ? conversation.org : '',
        chats: conversation.app === 'teams' && !conversation.workspace,
        channels: [],
      }
      app.spaces.push(space)
    }
    // The pinned thread first in its conversation, then the rest in their order.
    space.channels.push({
      key: `${spaceKey}/${conversation.name}`,
      conversation,
      threads: [...own.filter((t) => t.pinned), ...own.filter((t) => !t.pinned)],
    })
  }
  return [...apps.values()]
}
