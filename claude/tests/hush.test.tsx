import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'hush',
  component: 'Pane',
  requestId: 'activity',
  props: {
    title: 'Activity',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const TOOL_ROW = {
  plugin: 'hush',
  component: 'ToolUse',
  requestId: 't1',
  surface: 'terminal',
  props: {
    tool_use_id: 't1',
    tool: 'Bash',
    input: { command: 'git status' },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    isExpanded: false,
  },
} as const

test('the pane lists a call and expands its output', async ($, on) => {
  on('command.register', () => ({ value: { command: 'hush' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: 'On branch main', stderr: '' } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'git status', tool_use_id: 't1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /On branch main/ })) ?? null).toBe(null)
  await ui.press({ key: 't1' })
  expect((await ui.find({ type: 'Text', text: /On branch main/ }))?.text).toBe('On branch main')
  await ui.unmount()
})

const SHOWN = { id: 'activity', title: 'Activity', isShown: true, isFocused: false, isPlaced: true }

test('a tool row in the chat draws nothing until turned back on', async ($, on) => {
  on('ui.panes', () => ({ value: [SHOWN] }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })

  const row = await $.ui.mount(TOOL_ROW)
  expect((await row.find({ type: 'Text', text: /engine row/ })) ?? null).toBe(null)
  await row.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'toggle-chat' })
  await pane.unmount()

  const shown = await $.ui.mount(TOOL_ROW)
  expect((await shown.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  await shown.unmount()
})

test('ctrl+o (isExpanded) draws the engine row', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })

  const row = await $.ui.mount({ ...TOOL_ROW, props: { ...TOOL_ROW.props, isExpanded: true } })
  expect((await row.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  await row.unmount()
})

test('Minimize narrows the pane, and Expand restores it', async ($, on) => {
  const widths: Array<number | undefined> = []
  on('ui.open', (_, e) => {
    widths.push(e.columns)
    return { value: { isPlaced: true } }
  })

  const before = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await before.press({ key: 'minimize' })
  expect(widths).toEqual([24])
  await before.unmount()

  const mini = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await mini.find({ type: 'Text', text: /0 calls/ }))?.text).toBe('0 calls')
  await mini.press({ key: 'expand' })
  expect(widths).toEqual([24, 60])
  await mini.unmount()

  const full = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await full.find({ type: 'Text', text: /No tool calls yet/ }))?.text).toBe('No tool calls yet.')
  await full.unmount()
})

test('tool rows draw inline while the pane is not on screen', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine row</Text>
  })

  const cases = [[], [{ ...SHOWN, isPlaced: false }], [{ ...SHOWN, isShown: false }]]
  let panes = cases[0]
  on('ui.panes', () => ({ value: panes }))

  for (const one of cases) {
    panes = one
    const row = await $.ui.mount(TOOL_ROW)
    expect((await row.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
    await row.unmount()
  }
})

test('Close pane, in the minimized pane, closes it', async ($, on) => {
  const closed: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })

  const full = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await full.press({ key: 'minimize' })
  await full.unmount()

  const mini = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await mini.press({ key: 'close' })
  expect(closed).toEqual(['activity'])
  await mini.unmount()
})

test('an inline seat closes the pane; a wide band reopens it', async ($, on) => {
  const clock = mock.clock(on)
  const opens: number[] = []
  const closed: string[] = []
  on('command.register', () => ({ value: { command: 'hush' } }))
  on('ui.open', () => {
    opens.push(1)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>band</Text>
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const startOpens = opens.length

  const inline = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, placement: 'inline' } })
  await inline.unmount()
  await clock.advance(500)
  expect(closed).toEqual(['activity'])

  const BAND = {
    plugin: 'hush',
    component: 'AbovePrompt',
    requestId: 'band',
    surface: 'terminal',
    props: { hasSurvey: false, isWorking: false },
  } as const
  const narrow = await $.ui.mount({ ...BAND, viewport: { columns: 80, rows: 40 } })
  await narrow.unmount()
  await clock.advance(500)
  expect(opens.length).toBe(startOpens)

  const wide = await $.ui.mount({ ...BAND, viewport: { columns: 160, rows: 40 } })
  await wide.unmount()
  await clock.advance(500)
  expect(opens.length).toBe(startOpens + 1)
})
