import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DockSession, DockStatus, DockView } from '../types'

const PANE = 'session-dock'
const TITLE = 'Sessions'
const HEARTBEAT_MS = 60_000
const REFRESH_MS = 5_000
const OFFLINE_MS = 5 * 60_000
const ASK_DELAY_MS = 1_500

const view = atom(
  { plugin: 'session-dock', key: 'view' } as const,
  { sessions: [], now: 0, selfId: '' },
  { shape: 'view-1' },
)

// Module state: rebuilt on reload, refilled at session.start.
let dir = ''
let me: DockSession | undefined
let pendingChecks = 0

type Look = { label: string; tint: string; glyph: string }
const LOOKS: Record<DockStatus | 'offline', Look> = {
  working: { label: 'Working', tint: '#FF8A00', glyph: 'M12 4v4M12 16v4M4 12h4M16 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8' },
  waiting: { label: 'Needs you', tint: '#FFD27A', glyph: 'M12 6v7M12 17v.5' },
  idle: { label: 'Idle', tint: '#9AA4B2', glyph: 'M7 12h10' },
  offline: { label: 'Offline', tint: '#6B7078', glyph: 'M8 8l8 8M16 8l-8 8' },
  closed: { label: 'Closed', tint: '#6B7078', glyph: 'M8 12l3 3 5-6' },
}
const ORDER: (DockStatus | 'offline')[] = ['waiting', 'working', 'idle', 'offline']

// Cool, neutral hues only (no warm gradients), one per session.
const HUES = ['#4A6FA5', '#3F8F8A', '#6B5FA8', '#5B7F99', '#4F7D63', '#7A6F9B', '#3E6E8E', '#5E6B7D']

function hash(text: string): number {
  let n = 0
  for (const ch of text) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return n
}

function shown(s: DockSession, now: number): DockStatus | 'offline' {
  if (s.status === 'closed') return 'closed'
  return now - s.updatedAt > OFFLINE_MS ? 'offline' : s.status
}

function ago(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60_000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

function iconSvg(look: Look): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.22"/>` +
    `<stop offset="1" stop-color="#FFFFFF" stop-opacity="0.04"/></linearGradient></defs>` +
    `<rect x="1" y="1" width="22" height="22" rx="6" fill="#2A2D31"/>` +
    `<rect x="1" y="1" width="22" height="22" rx="6" fill="url(#g)" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="0.5"/>` +
    `<path d="${look.glyph}" stroke="${look.tint}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
    `</svg>`
  )
}

function backdropSvg(hue: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">` +
    `<defs><radialGradient id="a" cx="0.2" cy="0.15" r="0.7">` +
    `<stop offset="0" stop-color="${hue}" stop-opacity="0.35"/><stop offset="1" stop-color="${hue}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="b" cx="0.9" cy="0.95" r="0.6">` +
    `<stop offset="0" stop-color="${hue}" stop-opacity="0.18"/><stop offset="1" stop-color="${hue}" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="1600" height="1000" fill="#16181B"/>` +
    `<rect width="1600" height="1000" fill="url(#a)"/><rect width="1600" height="1000" fill="url(#b)"/>` +
    `</svg>`
  )
}

async function save($: EngineInterface, patch: Partial<DockSession>) {
  if (!me || !dir) return
  me = { ...me, ...patch, updatedAt: await $.clock.now() }
  try {
    await $.fs.write(`${dir}/${me.id}.json`, JSON.stringify(me))
  } catch {
    // a failed write only makes this session look stale to the others
  }
}

async function refresh($: EngineInterface) {
  if (!dir) return
  const now = await $.clock.now()
  const sessions: DockSession[] = []
  try {
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      try {
        const s = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as DockSession
        if (s.status === 'closed' && now - s.updatedAt > 60 * 60_000) continue
        if (now - s.updatedAt > 3 * 24 * 60 * 60_000) continue
        sessions.push(s)
      } catch {
        // half-written file: skip until next refresh
      }
    }
  } catch {
    // folder not there yet
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  await update($, view, () => ({ sessions, now, selfId: me?.id ?? '' }))
  const count = (st: DockStatus | 'offline') => sessions.filter(s => shown(s, now) === st).length
  $.ui.status(`${count('working')} working · ${count('waiting')} need you · ${count('idle')} idle`)
}

// Never throws: a status write must not hold up the hook that calls it.
async function setStatus($: EngineInterface, status: DockStatus) {
  if (me?.status === status) return
  try {
    await save($, { status })
    await refresh($)
  } catch {
    // shown on the next refresh
  }
}

const EMOJI: Record<DockStatus | 'offline', string> = {
  working: '⚙️', waiting: '✋', idle: '💤', offline: '⚪', closed: '✓',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
    dir = home ? `${home}/.claude/session-dock` : ''
    const id = await $.session.id()
    const cwd = await $.session.cwd()
    const repo = await $.session.repo().catch(() => null)
    const name = cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'session'
    const branch = repo && 'branch' in repo && typeof repo.branch === 'string' ? repo.branch : ''
    me = { id, name, branch, status: 'idle', task: '', updatedAt: 0 }
    await save($, {})

    await $.command.register({ name: 'sessions', description: 'Open the session dock' })
    void $.ui.open({ id: PANE, title: TITLE })
    void $.ui.backdrop({ id: 'calm', glass: { blur: 18, opacity: 0.6 } })
    $.clock.every(REFRESH_MS, () => void refresh($))
    $.clock.every(HEARTBEAT_MS, () => void save($, {}))
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)
    return { text: 'Session dock opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const text = typeof e.text === 'string' ? e.text.replace(/\s+/g, ' ').trim() : ''
    if (text && !text.startsWith('/')) await save($, { task: text.slice(0, 70) }).catch(() => {})
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await setStatus($, 'working')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await setStatus($, 'idle')
    return done
  })

  // A permission question that stays open means the session needs you.
  on('tool.check', async ($, e, next) => {
    pendingChecks++
    const timer = $.clock.after(ASK_DELAY_MS, () => void setStatus($, 'waiting'))
    try {
      return await next(e)
    } finally {
      timer.cancel()
      pendingChecks--
      if (pendingChecks === 0 && me?.status === 'waiting') await setStatus($, 'working')
    }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    await setStatus($, 'waiting')
    const ran = await next(e)
    await setStatus($, 'working')
    return ran
  })

  on('session.end', async ($, e, next) => {
    await save($, { status: 'closed' })
    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== 'session-dock') return next(e)
    const els = $.ui.resolve(e)
    if (!('Svg' in els)) return next(e)
    const { Svg } = els
    const hue = HUES[hash(me?.id ?? '') % HUES.length] ?? '#4A6FA5'
    return <Svg source={backdropSvg(hue)} alt="" width={1600} height={1000} />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const v: DockView = await read($, view)
    const live = v.sessions.filter(s => s.status !== 'closed')

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        {live.length === 0 && <Text dimColor>No sessions yet.</Text>}
        {ORDER.map(st => {
          const items = live.filter(s => shown(s, v.now) === st)
          if (items.length === 0) return null
          const look = LOOKS[st]
          return (
            <Box key={st} flexDirection="column" gap={1}>
              <Text bold color={look.tint}>
                {look.label} · {items.length}
              </Text>
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                {items.map(s => (
                  <Box
                    key={s.id}
                    flexDirection="column"
                    alignItems="center"
                    width={20}
                    paddingX={1}
                    paddingY={1}
                    borderStyle="round"
                    borderColor={s.id === v.selfId ? look.tint : '#3A3D42'}
                    hover={{ borderColor: look.tint }}
                  >
                    {Svg ? (
                      <Svg source={iconSvg(look)} alt={look.label} width={44} height={44} />
                    ) : (
                      <Text>{EMOJI[st]}</Text>
                    )}
                    <Text bold color="#FFF2DF" wrap="truncate-end">
                      {s.name}
                      {s.id === v.selfId ? ' (this)' : ''}
                    </Text>
                    {s.branch !== '' && <Text dimColor wrap="truncate-end">{s.branch}</Text>}
                    {s.task !== '' && <Text wrap="truncate-end">{s.task}</Text>}
                    <Text dimColor>{ago(s.updatedAt, v.now)}</Text>
                  </Box>
                ))}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
