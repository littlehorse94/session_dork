export type DockStatus = 'working' | 'waiting' | 'idle' | 'closed'
export type DockSession = {
  id: string
  name: string
  branch: string
  status: DockStatus
  task: string
  updatedAt: number
}
export type DockView = { sessions: DockSession[]; now: number; selfId: string }

declare module 'claude-code' {
  interface PluginState {
    'session-dock': { view: Shaped<DockView> }
  }
}
