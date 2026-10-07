/** Render a bounded terminal screen with independent conversation and details scrolling. */
import React, {useEffect, useReducer, useRef, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import {clean, lines, conversationLines, details, activityStatus, shortcutHints} from './view.js';
import {Editor} from './editor.js';
import type {Session} from './session.js';

/** Animate only this small row, without reformatting conversation or details on each tick. */
function ActivityRow({name, text, running, waiting}: {name: string; text: string; running: boolean; waiting: boolean}): React.JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setFrame(n => (n + 1) % 4), 120);
    return () => clearInterval(timer);
  }, [running]);
  return <Text color="gray" wrap="truncate-end"><Text color={waiting ? 'yellow' : running ? 'cyan' : 'gray'}>{waiting ? '?' : running ? ['|', '/', '-', '\\'][frame] : '·'}</Text> {clean(name)} · {clean(text).replace(/\n/g, ' ')}</Text>;
}

/** A viewport offset is a line index, or null to follow the latest output. */
function viewport(content: string[], height: number, offset: number | null): string {
  const start = offset === null ? Math.max(0, content.length - height) : Math.min(offset, Math.max(0, content.length - 1));
  return content.slice(start, start + height).join('\n');
}

export function App({session, version, onExit}: {session: Session; version: string; onExit: () => void}): React.JSX.Element {
  const [, rerender] = useReducer(n => n + 1, 0);
  useEffect(() => {const change = () => rerender(); session.on('change', change); return () => {session.off('change', change);};}, [session]);
  const {columns, rows} = useWindowSize();
  const width = Math.max(10, columns - 1);
  const height = Math.max(10, rows - 1);
  const inputHistory = useRef<string[]>([]);
  const latestWidth = useRef(width);
  latestWidth.current = width;
  const state = session.state;
  const [expanded, setExpanded] = useState(false);
  const [focusDetails, setFocusDetails] = useState(false);
  const [chatOffset, setChatOffset] = useState<number | null>(null);
  const [detailOffset, setDetailOffset] = useState<number | null>(null);
  const [shownAlertItem, setShownAlertItem] = useState(state.alertItem);
  if (shownAlertItem !== state.alertItem) {
    setShownAlertItem(state.alertItem);
    setDetailOffset(state.alertItem ? 0 : null);
  }
  const [promptOffset, setPromptOffset] = useState<number | null>(0);
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, {answers: string[]}>>({});
  const [selection, setSelection] = useState(0);
  const [busy, setBusy] = useState(false);
  const prompt = state.prompts[0];
  const promptKey = prompt ? `${prompt.id}:${prompt.revision}` : '';
  const [answerPrompt, setAnswerPrompt] = useState(promptKey);
  if (answerPrompt !== promptKey) {
    // Reset before rendering a revised request, never after its input is enabled.
    setAnswerPrompt(promptKey); setAnswer(''); setQuestionIndex(0); setAnswers({}); setPromptOffset(0);
  }
  const question = prompt?.questions?.[questionIndex];
  const activity = activityStatus(state);
  const alertRows = state.alerts.length ? 1 : 0;
  const space = Math.max(2, height - 1 - 1 - alertRows - 1 - 3 - 1);
  const lowerHeight = prompt || expanded ? Math.max(1, Math.floor(space / 2)) : 0;
  const chatHeight = space - lowerHeight;
  const formatted = conversationLines(state, width);
  const chat = formatted.length ? formatted : lines(state.phase === 'connecting' ? 'Connecting to Codex…' : 'Send a message to begin.', width);
  const technical = expanded && !prompt ? lines(details(state) || 'No details yet.', width) : [];
  const promptText = prompt ? [prompt.title, prompt.body,
    question ? `Question ${questionIndex + 1}/${prompt.questions!.length}: ${question.question}` : '',
    ...(question?.options?.map((option, i) => `${i + 1}. ${option.label} — ${option.description}`) ?? []),
    ...prompt.choices.map((choice, i) => `${i + 1}. ${choice.label}`),
    question ? 'Type an option number or your own answer; Enter submits.' : prompt.form ? 'Enter JSON to submit; type decline or cancel to refuse.' : 'Type a choice number and press Enter.',
  ].filter(Boolean).join('\n') : '';
  const promptLines = lines(promptText, width);
  const safeRun = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {await action();} catch (error) {session.alert((error as Error).message);} finally {setBusy(false);}
  };
  const loadOlder = async () => {
    if (!state.historyCursor || state.loadingHistory || state.phase !== 'ready') return;
    const previousItems = new Set(state.items);
    const threadId = state.threadId;
    try {
      await session.loadHistory();
      if (state.threadId !== threadId) return;
      const firstExisting = state.items.findIndex(item => previousItems.has(item));
      const prefix = conversationLines({...state, items: state.items.slice(0, Math.max(0, firstExisting))}, latestWidth.current);
      const added = prefix.length ? prefix.length + 1 : 0;
      // Keep the same message in view when older messages are inserted above it.
      setChatOffset(offset => offset === null ? null : offset + added);
    } catch (error) {session.alert((error as Error).message);}
  };
  const scroll = (direction: number) => {
    const lower = !!prompt || (expanded && focusDetails);
    const data = prompt ? promptLines : lower ? technical : chat;
    const size = lower ? lowerHeight - 1 : chatHeight;
    const update = (offset: number | null) => {
      const max = Math.max(0, data.length - size);
      const next = Math.max(0, Math.min(max, (offset ?? max) + direction * Math.max(1, size - 1)));
      return next === max && !prompt ? null : next;
    };
    if (prompt) setPromptOffset(update);
    else if (lower) setDetailOffset(update);
    else {
      const next = update(chatOffset);
      setChatOffset(direction < 0 && next === null ? 0 : next);
      if (direction < 0 && (next === 0 || next === null)) void loadOlder();
    }
  };
  useInput((input, key) => {
    if (key.ctrl && input === 'd') {onExit(); return;}
    if (key.ctrl && input === 'c') {
      if (state.phase === 'connecting' || state.phase === 'disconnected') onExit();
      else if (state.activeTurn || state.sending) void session.interrupt();
      else {setDraft(''); setAnswer('');}
      return;
    }
    if (key.ctrl && input === 'o') {
      if (!expanded && state.alertItem) setDetailOffset(0);
      setExpanded(!expanded); setFocusDetails(!expanded); return;
    }
    if (key.ctrl && input === 'l') {session.dismissAlerts(); return;}
    if (key.tab && expanded && !prompt) setFocusDetails(!focusDetails);
    if (key.pageUp) scroll(-1);
    if (key.pageDown) scroll(1);
    if (state.phase === 'picking' && !busy) {
      if (key.upArrow) setSelection(Math.max(0, selection - 1));
      if (key.downArrow) setSelection(Math.min(state.sessions.length - 1, selection + 1));
      if (input === 'n' && state.sessionsCursor) void safeRun(() => session.listSessions(true));
      if (key.return && state.sessions[selection]) void safeRun(() => session.open(state.sessions[selection]!.id));
    }
  });

  const submitPrompt = (value: string) => {
    if (!prompt) return;
    try {
      if (question) {
        const index = /^\d+$/.test(value.trim()) ? Number(value.trim()) - 1 : -1;
        const selected = question.options?.[index];
        const response = {...answers, [question.id]: {answers: [selected?.label ?? value]}};
        if (questionIndex + 1 < prompt.questions!.length) {setAnswers(response); setQuestionIndex(questionIndex + 1); setAnswer(''); setPromptOffset(0);}
        else session.respond(prompt.id, {answers: response}, prompt.revision);
      } else if (prompt.form && !['decline', 'cancel'].includes(value.trim())) {
        const content = JSON.parse(value);
        if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('Enter a JSON object.');
        session.respond(prompt.id, {action: 'accept', content, _meta: null}, prompt.revision);
      } else {
        const choice = prompt.form ? prompt.choices.find(c => c.label.toLowerCase() === value.trim()) : prompt.choices[Number(value.trim()) - 1];
        if (!choice || !prompt.form && !/^\d+$/.test(value.trim())) throw new Error('Enter one of the displayed choice numbers.');
        session.respond(prompt.id, choice.result, prompt.revision);
      }
      setAnswer('');
    } catch (error) {session.alert((error as Error).message);}
  };
  const submit = (value: string) => {
    if (prompt) submitPrompt(value);
    else if (['exit', '/exit'].includes(value.trim())) onExit();
    else if (/^\/rename(?:\s|$)/.test(value.trim())) void safeRun(async () => {await session.rename(value.trim().slice(7)); setDraft('');});
    else void session.send(value).then(sent => {if (sent) setDraft('');});
  };
  const shortcuts = shortcutHints(width, state.phase === 'picking'
    ? ['↑/↓ select', 'Enter resume', ...(state.sessionsCursor ? ['n more sessions'] : [])]
    : state.phase === 'disconnected' ? ['Restart Hush to resume']
    : [...(state.alerts.length ? ['Ctrl+L dismiss alert'] : []),
      ...(expanded && !prompt ? ['Tab switch pane'] : []), 'PgUp/PgDn scroll',
      'Alt+Enter newline']);
  const heading = clean(`hush · ${session.options.cwd} · ${state.model ?? version}${state.threadId ? ' · ' + (state.name ?? state.threadId) : ''}`);
  if (columns < 35 || rows < 16) return <Box flexDirection="column"><Text>Enlarge terminal to at least 35×16.</Text><Text>Ctrl+C stops work · Ctrl+D exits</Text></Box>;
  return <Box flexDirection="column" height={height} width={width}>
    <Text color="gray" bold wrap="truncate-end">{heading}</Text>
    {state.phase === 'picking' ? <Box height={chatHeight} flexDirection="column">
      <Text bold>Resume session · ↑/↓ select · Enter open · n more</Text>
      {!state.sessions.length && <Text>No sessions here. Use hush resume --all, or hush to start.</Text>}
      {state.sessions.slice(Math.max(0, selection - chatHeight + 3), Math.max(0, selection - chatHeight + 3) + chatHeight - 1).map(thread =>
        <Text key={thread.id} wrap="truncate-end" color={state.sessions[selection]?.id === thread.id ? 'cyan' : 'white'}>
          {state.sessions[selection]?.id === thread.id ? '› ' : '  '}{clean(thread.name ?? thread.preview ?? thread.id)} · {new Date(thread.updatedAt * 1000).toLocaleString()}{session.options.all ? ` · ${clean(thread.cwd)}` : ''}
        </Text>)}
    </Box> : <Box height={chatHeight} overflow="hidden"><Text color="white">{viewport(chat, chatHeight, chatOffset)}</Text></Box>}
    {lowerHeight > 0 && <Box height={lowerHeight} flexDirection="column" overflow="hidden">
      <Text color={prompt ? 'yellow' : 'cyan'} wrap="truncate-end">{prompt ? `Request · ${state.prompts.length} pending · PgUp/PgDn scroll` : `Details · ${focusDetails ? 'scrolling here' : 'Tab to scroll here'} · Ctrl+O close`}</Text>
      <Text color="white">{viewport(prompt ? promptLines : technical, lowerHeight - 1, prompt ? promptOffset : detailOffset)}</Text>
    </Box>}
    <ActivityRow name="Codex" {...activity}/>
    {state.alerts.length > 0 && <Text color="yellow" wrap="truncate-end">! {clean(state.alerts.at(-1)!).replace(/\n/g, ' ')}{state.alertItem && !expanded && !prompt ? ' · Ctrl+O for details' : ''}</Text>}
    <Text color="gray" wrap="truncate-end">{expanded ? '▾ Details · Ctrl+O to close' : '▸ Details · Ctrl+O to expand'}{state.loadingHistory ? ' · Loading older messages…' : ''}</Text>
    <Editor key={prompt ? `prompt:${prompt.id}:${prompt.revision}:${questionIndex}` : 'draft'} value={prompt ? answer : draft} onChange={prompt ? setAnswer : setDraft}
      onSubmit={submit} disabled={state.phase !== 'ready' || state.sending || state.interrupting || busy} secret={question?.isSecret ?? false} width={width} history={prompt ? undefined : inputHistory}/>
    <Text color="gray">{shortcuts}</Text>
  </Box>;
}
