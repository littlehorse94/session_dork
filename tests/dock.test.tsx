import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-dock',
  component: 'Pane',
  requestId: 'session-dock',
  props: {
    title: 'Sessions',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('a working session shows in the dock on every surface', async ($, on) => {
  const files = new Map<string, string>()
  let now = 1_000_000
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/home/me/my-project' }))
  on('session.repo', () => ({ value: null }))
  on('clock.now', () => ({ value: now }))
  on('clock.every', () => ({ value: undefined }))
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({
    value: [...files.keys()].map(p => ({
      name: p.split('/').pop() ?? '', kind: 'file', size: 1, mtimeMs: now, isLink: false,
    })),
  }))
  on('fs.read', (_, e) => ({ value: files.get(e.path) ?? '' }))
  on('command.register', () => ({ value: { command: 'sessions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.backdrop', () => ({ value: { isDrawn: true, requestId: 'b' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('ui.status', () => ({ value: undefined }))

  await $.session.start({ cwd: '/home/me/my-project', surface: 'desktop', isInteractive: true })
  expect(files.has('/home/me/.claude/session-dock/abc.json')).toBe(true)

  now += 1000
  await $.turn.start({ turnId: 't1' })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Working/ }))?.text).toContain('Working · 1')
    expect((await ui.find({ type: 'Text', text: /my-project/ }))?.text).toContain('(this)')
    await ui.unmount()
  }
})
