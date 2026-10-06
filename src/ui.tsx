/** Render a bounded terminal screen with independent conversation and details scrolling. */
import React, {useEffect, useReducer, useState} from 'react';
import {Box, Text, useInput, usePaste, useWindowSize} from 'ink';
import {clean, lines, conversationLines, details, counts} from './view.js';
import type {Session} from './session.js';

/** Keep the draft editable during streaming, and submit only on an explicit Enter. */
function Editor({value, onChange, onSubmit, disabled, secret, width}: {
  value: string; onChange: (text: string) => void; onSubmit: (text: string) => void;
  disabled: boolean; secret: boolean; width: number;
}): React.JSX.Element {
  const [cursor, setCursor] = useState(value.length);
  const at = Math.min(cursor, value.length);
  const insert = (text: string) => {
    const safe = clean(text);
    onChange(value.slice(0, at) + safe + value.slice(at));
    setCursor(at + safe.length);
  };
  usePaste(insert, {isActive: !disabled});
  useInput((input, key) => {
    if (key.ctrl && input === 'u') {onChange(''); setCursor(0); return;}
    if (key.ctrl || key.tab || key.escape || key.pageUp || key.pageDown || key.upArrow || key.downArrow) return;
    if (key.return) {
      if (key.meta || key.shift) insert('\n');
      else if (value.trim()) onSubmit(value);
      return;
    }
    if (key.leftArrow) {setCursor(at - (Array.from(value.slice(0, at)).at(-1)?.length ?? 0)); return;}
    if (key.rightArrow) {setCursor(at + (Array.from(value.slice(at))[0]?.length ?? 0)); return;}
    if (key.home) {setCursor(0); return;}
    if (key.end) {setCursor(value.length); return;}
    if (key.delete) {
      const size = Array.from(value.slice(at))[0]?.length ?? 0;
      onChange(value.slice(0, at) + value.slice(at + size)); return;
    }
    if (key.backspace) {
      const size = Array.from(value.slice(0, at)).at(-1)?.length ?? 0;
      onChange(value.slice(0, at - size) + value.slice(at)); setCursor(at - size); return;
    }
    if (!key.meta) insert(input);
  }, {isActive: !disabled});
  const shown = secret ? '•'.repeat(value.length) : value;
  const rendered = lines(`> ${shown.slice(0, at)}${disabled ? '' : '▏'}${shown.slice(at)}`, width);
  const cursorLine = lines(`> ${shown.slice(0, at)}`, width).length - 1;
  return <Box height={3} flexDirection="column"><Text color="cyan">{rendered.slice(Math.max(0, cursorLine - 2), Math.max(0, cursorLine - 2) + 3).join('\n')}</Text></Box>;
}

/** Animate only this small row, without reformatting conversation or details on each tick. */
function ActivityRow({name, text, running, waiting}: {name: string; text: string; running: boolean; waiting: boolean}): React.JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setFrame(n => (n + 1) % 4), 120);
    return () => clearInterval(timer);
  }, [running]);
  return <Text color="gray" wrap="truncate-end"><Text color={waiting ? 'yellow' : running ? 'cyan' : 'gray'}>{waiting ? '?' : running ? ['|', '/', '-', '\\'][frame] : '·'}</Text> {clean(name)} · {waiting ? 'Waiting for your input' : clean(text).replace(/\n/g, ' ')}</Text>;
}

/** A viewport offset is a line index, or null to follow the latest output. */
function viewport(content: string[], height: number, offset: number | null): string {
  const start = offset === null ? Math.max(0, content.length - height) : Math.min(offset, Math.max(0, content.length - height));
  return content.slice(start, start + height).join('\n');
}

export function App({session, version, onExit}: {session: Session; version: string; onExit: () => void}): React.JSX.Element {
  const [, rerender] = useReducer(n => n + 1, 0);
  useEffect(() => {const change = () => rerender(); session.on('change', change); return () => {session.off('change', change);};}, [session]);
  const {columns, rows} = useWindowSize();
  const width = Math.max(10, columns - 1);
  const height = Math.max(10, rows - 1);
  const state = session.state;
  const [expanded, setExpanded] = useState(false);
  const [focusDetails, setFocusDetails] = useState(false);
  const [chatOffset, setChatOffset] = useState<number | null>(null);
  const [detailOffset, setDetailOffset] = useState<number | null>(null);
  const [promptOffset, setPromptOffset] = useState<number | null>(0);
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, {answers: string[]}>>({});
  const [selection, setSelection] = useState(0);
  const [busy, setBusy] = useState(false);
  const prompt = state.prompts[0];
  useEffect(() => {setAnswer(''); setQuestionIndex(0); setAnswers({}); setPromptOffset(0);}, [prompt?.id, prompt?.revision]);
  const question = prompt?.questions?.[questionIndex];
  const activities = [...state.activities.entries()];
  const activityRows = Math.min(3, activities.length);
  const alertRows = state.alerts.length ? 2 : 0;
  const space = Math.max(2, height - 1 - activityRows - alertRows - 1 - 3 - 1);
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
    else setChatOffset(update);
  };
  useInput((input, key) => {
    if (key.ctrl && input === 'd') {onExit(); return;}
    if (key.ctrl && input === 'c') {
      if (state.phase === 'connecting' || state.phase === 'disconnected') onExit();
      else if (state.activeTurn || state.sending) void session.interrupt();
      else {setDraft(''); setAnswer('');}
      return;
    }
    if (key.ctrl && input === 'o') {setExpanded(!expanded); setFocusDetails(!expanded); return;}
    if (key.ctrl && input === 'l') {session.dismissAlerts(); return;}
    if (key.tab && expanded && !prompt) setFocusDetails(!focusDetails);
    if (key.pageUp) scroll(-1);
    if (key.pageDown) scroll(1);
    if (key.ctrl && input === 'b' && state.historyCursor) {
      void safeRun(() => session.loadHistory());
      setChatOffset(0);
    }
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
    {activities.slice(0, activityRows).map(([id, activity]) => {
      const waiting = state.prompts.some(request => request.threadId === id);
      const running = state.phase === 'ready' && !waiting && (id === state.threadId
        ? !!(state.activeTurn || state.sending || state.interrupting) : activity.running);
      const text = id === state.threadId && state.sending && !state.activeTurn ? 'Starting…'
        : id === state.threadId && state.interrupting ? 'Interrupting…'
        : state.phase === 'disconnected' ? 'Disconnected'
        : running && activity.text === 'Ready' ? 'Working' : activity.text;
      return <ActivityRow key={id} name={activity.name} text={text} running={running} waiting={waiting}/>;
    })}
    {state.alerts.length > 0 && <Box height={2} flexDirection="column"><Text color="yellow" wrap="truncate-end">{clean(state.alerts.at(-1)!)}</Text><Text color="gray">{state.alerts.length} notice(s) · details contain full text · Ctrl+L dismiss</Text></Box>}
    <Text color="gray" wrap="truncate-end">{expanded ? '▾' : '▸'} Details · {counts(state)}{activities.length > 3 ? ` · ${activities.length - 3} more agents in details` : ''}{state.historyCursor ? ' · Ctrl+B older messages' : ''}</Text>
    <Editor key={prompt ? `prompt:${prompt.id}:${prompt.revision}:${questionIndex}` : 'draft'} value={prompt ? answer : draft} onChange={prompt ? setAnswer : setDraft}
      onSubmit={submit} disabled={state.phase !== 'ready' || state.sending || state.interrupting || busy} secret={question?.isSecret ?? false} width={width}/>
    <Text color="gray" wrap="truncate-end">{state.phase === 'disconnected' ? 'Disconnected · restart Hush to resume · Ctrl+D exit' : state.interrupting ? 'Interrupting…' : 'Enter send · Ctrl+O details · PgUp/PgDn scroll · Ctrl+C stop · Ctrl+D exit'}</Text>
  </Box>;
}
