import { describe, expect, it } from 'vitest'
import { DEFAULT_QUICK_ACTION_ITEMS, hideQuickBarIn, quickBarShowsIn, type QuickActionSettings } from './store'

const slack = { exe: 'slack.exe', name: 'Slack' }
const edge = { exe: 'msedge.exe', name: 'Microsoft Edge' }
const qa = (patch: Partial<QuickActionSettings>): QuickActionSettings => ({
  enabled: true,
  appScope: 'all',
  apps: [],
  hiddenApps: [],
  display: 'iconText',
  items: DEFAULT_QUICK_ACTION_ITEMS,
  ...patch,
})

describe('hideQuickBarIn', () => {
  it('turns the toolbar off in one app while it shows in every other', () => {
    const hidden = hideQuickBarIn(qa({}), edge)
    expect(hidden.hiddenApps).toEqual([edge])
    expect(quickBarShowsIn(hidden, 'MSEdge.exe')).toBe(false)
    expect(quickBarShowsIn(hidden, 'slack.exe')).toBe(true)
    // Twice is the same as once.
    expect(hideQuickBarIn(hidden, { exe: 'MSEDGE.EXE', name: 'Edge' }).hiddenApps).toEqual([edge])
  })

  it('takes the app out of the chosen apps when the toolbar is limited to them', () => {
    const hidden = hideQuickBarIn(qa({ appScope: 'selected', apps: [slack, edge] }), slack)
    expect(hidden.apps).toEqual([edge])
    expect(hidden.hiddenApps).toEqual([])
    expect(quickBarShowsIn(hidden, 'slack.exe')).toBe(false)
  })

  it('never shows when the toolbar is off', () => {
    expect(quickBarShowsIn(qa({ enabled: false }), 'slack.exe')).toBe(false)
  })
})
