/** Derive terminal-safe conversation and details text from session items. */
import {stripVTControlCharacters} from 'node:util';
import wrapAnsi from 'wrap-ansi';
import type {State, Item} from './session.js';

/** External text must not emit terminal controls, hyperlinks, or clipboard escape sequences. */
export function clean(text: string): string {
  return stripVTControlCharacters(text).replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
export function lines(text: string, width: number): string[] {
  return wrapAnsi(clean(text).replace(/\t/g, '    '), Math.max(1, width), {hard: true, trim: false}).split('\n');
}
export function conversation(state: State): string {
  return state.items.filter(item => item.threadId === state.threadId).flatMap(({value: v, complete}) => {
    if (v.type === 'userMessage') return [`You\n${v.content.map(input => input.type === 'text' ? input.text : `[${input.type}]`).join('\n')}`];
    if (v.type === 'agentMessage' && (v.phase === 'final_answer' || (v.phase !== 'commentary' && complete) || v.delivery === 'async' || v.questions?.length)) {
      return [`Codex\n${v.text}${v.questions?.length ? '\n' + v.questions.map(q => q.title + (q.options?.length ? '\n' + q.options.join(' · ') : '')).join('\n') : ''}`];
    }
    if (v.type === 'plan' && complete) return [`Codex plan\n${v.text}`];
    return [];
  }).join('\n\n');
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
