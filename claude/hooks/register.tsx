import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Call } from '../types'

const PANE = 'activity'
const MAX_CALLS = 300
const MAX_OUTPUT = 4000
const MAX_OPEN_LINES = 40
// Dock widths: the engine's narrowest dock, and the expanded pane's request.
const MINIMIZED_COLUMNS = 24
const EXPANDED_COLUMNS = 60
// The terminal width the engine docks a pane from; below it a pane seats inline
// above the prompt, which this mod closes rather than draws.
const DOCK_FROM_COLUMNS = 110

// Change the tag when Call's fields change: it declines what an earlier
// version stored, which outlives a reload.
const calls = atom({ plugin: 'hush', key: 'calls' } as const, [], {
  shape: 'calls-1',
})
const openId = atom({ plugin: 'hush', key: 'openId' } as const, '')
const showInChat = atom(
  { plugin: 'hush', key: 'showInChat' } as const,
  false,
)
const isMinimized = atom(
  { plugin: 'hush', key: 'isMinimized' } as const,
  false,
)
const isClosedForNarrow = atom(
  { plugin: 'hush', key: 'isClosedForNarrow' } as const,
  false,
)

/** One line naming what a call acts on: the command, the path, the pattern. */
function summarize(e: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'pattern', 'url', 'query', 'description', 'prompt']) {
    const value = e[key]
    if (typeof value === 'string' && value !== '') {
      return (value.split('\n')[0] ?? '').slice(0, 120)
    }
  }
  return ''
}

/** The tool's result as text: Bash's stdout and stderr, else the string or JSON. */
function render(result: unknown): string {
  let text: string
  if (typeof result === 'string') {
    text = result
  } else if (result && typeof result === 'object' && 'stdout' in result) {
    const r = result as { stdout?: string; stderr?: string }
    text = [r.stdout, r.stderr].filter(Boolean).join('\n')
  } else {
    text = JSON.stringify(result, null, 2) ?? ''
  }
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…` : text
}

/** Opens (or re-sizes) the pane at the width its minimized state asks for. */
async function openPane($: EngineInterface, minimized: boolean) {
  await update($, isMinimized, () => minimized)
  const opened = await $.ui.open({
    id: PANE,
    title: 'Activity',
    columns: minimized ? MINIMIZED_COLUMNS : EXPANDED_COLUMNS,
  })
  // Tool rows hide only while the pane is on screen, so redraw them.
  $.ui.invalidate('ui.render')
  return opened
}

/** Whether the pane is on screen now: placed and the tab the surface shows. */
async function isPaneShowing($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)
}

export const register: Register = on => {
  // What the render hooks last saw; drawing is pure, so a timer acts on these.
  let isSeatedInline = false
  let terminalColumns = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hush',
      description: 'Open the Activity pane (tool calls hidden from the chat)',
    })
    void openPane($, await read($, isMinimized))

    // A narrow terminal seats the pane inline above the prompt: close it there
    // (tool rows come back inline) and reopen it once the terminal can dock it.
    $.clock.every(500, async () => {
      if (isSeatedInline) {
        isSeatedInline = false
        await update($, isClosedForNarrow, () => true)
        await $.ui.close({ id: PANE })
      } else if (terminalColumns >= DOCK_FROM_COLUMNS && (await read($, isClosedForNarrow))) {
        await update($, isClosedForNarrow, () => false)
        await openPane($, await read($, isMinimized))
      }
    })

    return next(e)
  })

  on('command.run', { command: 'hush' }, async $ => {
    await openPane($, false)

    return { text: `Activity pane opened (shown from ${DOCK_FROM_COLUMNS} columns wide).` }
  })

  // Tool rows hide only while the pane is on screen, so redraw them on close.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    $.ui.invalidate('ui.render')
    return closed
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id ?? `${e.tool}-${await $.clock.now()}`
    const call: Call = {
      id,
      tool: e.tool,
      summary: summarize(e as Record<string, unknown>),
      isDone: false,
      isErrored: false,
      output: '',
    }
    await update($, calls, list => [...list, call].slice(-MAX_CALLS))
    const ran = await next(e)
    const done: Partial<Call> =
      'deny' in ran && ran.deny !== undefined
        ? { isDone: true, isErrored: true, output: `denied: ${ran.deny}` }
        : { isDone: true, isErrored: Boolean(ran.isError), output: render(ran.result) }
    await update($, calls, list =>
      list.map(one => (one.id === id ? { ...one, ...done } : one)),
    )

    return ran
  }).catch(($, e, next) => next(e))

  // Tool rows in the chat: drawn as nothing while the pane is on screen, unless
  // the person asked to see them (ctrl+o, --verbose) or turned them back on from
  // the pane. A width change re-runs these hooks, so a pane that loses its seat
  // to a narrower terminal brings the rows back.
  on(
    'ui.render',
    { component: ['ToolUse', 'ToolResult', 'ToolGroup'] },
    async ($, e, next) => {
      const isExpanded = 'isExpanded' in e.props && e.props.isExpanded === true
      if (isExpanded || (await read($, showInChat)) || !(await isPaneShowing($))) {
        return next(e)
      }
      const { Box } = $.ui.resolve(e)

      return <Box />
    },
  )

  // The band re-runs on every width change, so it reports the terminal's width.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    terminalColumns = e.viewport?.columns ?? terminalColumns

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    isSeatedInline = e.props.placement === 'inline'
    if (isSeatedInline) {
      return <Box />
    }
    const list = await read($, calls)
    const open = await read($, openId)
    const inChat = await read($, showInChat)
    const width = Math.max(20, e.props.bodyColumns - 4)

    if (await read($, isMinimized)) {
      const last = list.at(-1)
      return (
        <Box flexDirection="column">
          <Button key="expand" hotkey="e" label="◂ Expand" onPress={() => openPane($, false)} />
          <Text dimColor>{list.length} calls</Text>
          {last && (
            <Text dimColor>
              {!last.isDone ? '…' : last.isErrored ? '✗' : '✓'} {last.tool}
            </Text>
          )}
          <Text> </Text>
          <Button key="close" hotkey="x" label="✕ Close pane" onPress={() => $.ui.close({ id: PANE })} />
          <Text dimColor>Tools show inline.</Text>
          <Text dimColor>Reopen: /hush</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="minimize" hotkey="m" label="▸ Minimize" onPress={() => openPane($, true)} />
          <Text> </Text>
          <Button key="close" hotkey="x" label="✕ Close" onPress={() => $.ui.close({ id: PANE })} />
          <Text> </Text>
          <Button
            key="toggle-chat"
            hotkey="c"
            label={inChat ? 'Hide tools in chat' : 'Show tools in chat'}
            onPress={() => update($, showInChat, value => !value)}
          />
          <Text dimColor> {list.length} calls</Text>
        </Box>
        {list.length === 0 && <Text dimColor>No tool calls yet.</Text>}
        {list
          .slice()
          .reverse()
          .map(call => {
            const mark = !call.isDone ? '…' : call.isErrored ? '✗' : '✓'
            const isOpen = call.id === open
            return (
              <Box key={`row-${call.id}`} flexDirection="column">
                <Button
                  key={call.id}
                  plain
                  onPress={() => update($, openId, id => (id === call.id ? '' : call.id))}
                >
                  {isOpen ? '▾' : '▸'} {mark} {call.tool}{' '}
                  <Text dimColor>{call.summary.slice(0, width - call.tool.length - 6)}</Text>
                </Button>
                {isOpen && (
                  <Box paddingLeft={2} flexDirection="column">
                    {call.summary !== '' && <Text color="cyan">{call.summary}</Text>}
                    <Text dimColor>
                      {call.output.split('\n').slice(0, MAX_OPEN_LINES).join('\n') ||
                        (call.isDone ? '(no output)' : 'running…')}
                    </Text>
                  </Box>
                )}
              </Box>
            )
          })}
      </Box>
    )
  })
}
