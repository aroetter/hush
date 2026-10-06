/** Derive terminal-safe conversation and details text from session items. */
import {lines} from './terminal.js';
export {clean, lines} from './terminal.js';
import chalk, {type ChalkInstance} from 'chalk';
import stringWidth from 'string-width';
import {markdown} from './markdown.js';
import type {State, Item} from './session.js';

function messages(state: State): string[] {
  return state.items.filter(item => item.threadId === state.threadId).flatMap(({value: v, complete}) => {
    if (v.type === 'userMessage') return [`You\n${v.content.map(input => input.type === 'text' ? input.text : `[${input.type}]`).join('\n')}`];
    if (v.type === 'agentMessage' && (v.phase === 'final_answer' || (v.phase !== 'commentary' && complete) || v.delivery === 'async' || v.questions?.length)) {
      return [`Codex\n${v.text}${v.questions?.length ? '\n' + v.questions.map(q => q.title + (q.options?.length ? '\n' + q.options.join(' · ') : '')).join('\n') : ''}`];
    }
    if (v.type === 'plan' && complete) return [`Codex plan\n${v.text}`];
    return [];
  });
}
export function conversation(state: State): string {return messages(state).join('\n\n');}
export function conversationLines(state: State, width: number, colors: ChalkInstance = chalk): string[] {
  return messages(state).flatMap((message, index) => {
    const split = message.indexOf('\n');
    const role = message.slice(0, split);
    const body = message.slice(split + 1);
    const user = role === 'You';
    return [...(index ? [''] : []), (user ? colors.cyan : colors.white).bold(role),
      ...(user ? lines(body, width).map(line => colors.cyan(line)) : markdown(body, width, colors))];
  });
}
export function itemDetails({value: v, threadId}: Item): string {
  if (v.type === 'commandExecution') return `Command · ${v.status}\nDirectory: ${v.cwd}\n${v.command}\n${v.aggregatedOutput ?? ''}\nExit: ${v.exitCode ?? 'pending'}`;
  if (v.type === 'fileChange') return `File changes · ${v.status}\n${v.changes.map(change => `${change.path}\n${change.diff}`).join('\n')}`;
  if (v.type === 'agentMessage') return `Agent ${threadId} · ${v.phase ?? 'message'}\n${v.text}`;
  return JSON.stringify(v, null, 2);
}
export function details(state: State): string {
  const items = state.items.filter(item => item.value.type !== 'userMessage' && !(item.threadId === state.threadId && item.value.type === 'agentMessage' && item.value.phase === 'final_answer'));
  const activity = [...state.activities.values()].map(agent => `${agent.name} · ${agent.text}`).join('\n');
  return [counts(state), activity, ...items.map(itemDetails), ...[...state.details].map(([title, body]) => `${title}\n${body}`)].join('\n\n');
}
export function counts(state: State): string {
  const commands = state.items.filter(item => item.value.type === 'commandExecution').length;
  const files = new Set(state.items.flatMap(item => item.value.type === 'fileChange' ? item.value.changes.map(c => c.path) : []));
  return `${commands} commands · ${files.size} changed files`;
}

/** Keep internal agent paths and completed-agent rows in Details. */
export function activityStatus(state: State): {text: string; running: boolean; waiting: boolean} {
  if (state.phase !== 'ready') return {text: state.phase === 'connecting' ? 'Connecting…' : state.phase === 'picking' ? 'Choose a session' : 'Disconnected', running: false, waiting: false};
  const children = [...state.activities].filter(([id, activity]) => id !== state.threadId && activity.running && !state.prompts.some(prompt => prompt.threadId === id)).length;
  const rootRunning = !!(state.activeTurn || state.sending || state.interrupting);
  const waiting = state.prompts.length > 0;
  const running = !waiting && (rootRunning || children > 0);
  const root = state.activities.get(state.threadId ?? '');
  const text = waiting ? 'Waiting for your input' : state.interrupting ? 'Interrupting…'
    : state.sending && !state.activeTurn ? 'Starting…'
    : rootRunning ? (root?.text === 'Ready' || !root ? 'Working' : root.text) : children ? 'Agents working' : 'Ready';
  return {text: text + (children ? ` · ${children} agent${children === 1 ? '' : 's'} active` : ''), running, waiting};
}

/** Include complete shortcut hints in priority order, without cutting one in half. */
export function shortcutHints(width: number, hints: string[]): string {
  let text = '';
  for (const hint of hints) {
    const next = text ? `${text} · ${hint}` : hint;
    if (stringWidth(next) <= width) text = next;
  }
  return text;
}
