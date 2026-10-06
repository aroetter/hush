/** Derive terminal-safe conversation and details text from session items. */
import {lines} from './terminal.js';
export {clean, lines} from './terminal.js';
import chalk, {type ChalkInstance} from 'chalk';
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
  return [...items.map(itemDetails), ...[...state.details].map(([title, body]) => `${title}\n${body}`)].join('\n\n');
}
export function counts(state: State): string {
  const commands = state.items.filter(item => item.value.type === 'commandExecution').length;
  const files = new Set(state.items.flatMap(item => item.value.type === 'fileChange' ? item.value.changes.map(c => c.path) : []));
  return `${commands} commands · ${files.size} changed files`;
}
