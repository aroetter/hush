/** Cache formatting per item; assemble only the visible rows, never one giant transcript. */
import chalk from 'chalk';
import {markdown} from './markdown.js';
import {lines} from './terminal.js';
import {message, itemDetails, counts} from './view.js';
import type {Item, State} from './session.js';

export interface LineView {length: number; slice(start: number, end: number): string[]}
function blocks(parts: string[][]): LineView {
  const length = parts.reduce((n, part) => n + part.length, 0);
  return {length, slice(start, end) {
    const result: string[] = [];
    let offset = 0;
    for (const part of parts) {
      if (offset >= end) break;
      if (offset + part.length > start) result.push(...part.slice(Math.max(0, start - offset), end - offset));
      offset += part.length;
    }
    return result;
  }};
}

export class HistoryFormatter {
  private chat = new WeakMap<object, {width: number; complete: boolean; role?: string; rows: string[]}>();
  private tools = new WeakMap<object, {width: number; output?: string; rows: string[]}>();
  private logs = new Map<string, {width: number; text: string; rows: string[]}>();

  conversation(state: State, width: number): LineView {
    const parts: string[][] = [];
    let previous: string | undefined;
    for (const item of state.items) {
      if (item.threadId !== state.threadId) continue;
      let cached = this.chat.get(item.value);
      if (!cached || cached.width !== width || cached.complete !== item.complete) {
        const entry = message(item);
        cached = {width, complete: item.complete, role: entry?.role, rows: !entry ? [] : entry.role === 'You'
          ? lines(entry.body, width).map(line => chalk.cyan(line)) : markdown(entry.body, width)};
        this.chat.set(item.value, cached);
      }
      if (!cached.role) continue;
      if (previous) parts.push(['']);
      if (previous !== cached.role) parts.push([(cached.role === 'You' ? chalk.cyan : chalk.white).bold(cached.role)]);
      parts.push(cached.rows);
      previous = cached.role;
    }
    return blocks(parts);
  }

  details(state: State, width: number): LineView {
    const parts: string[][] = [];
    const add = (rows: string[]) => {if (parts.length) parts.push(['']); parts.push(rows);};
    const format = (item: Item) => {
      const output = state.details.get(`Output ${item.value.id}`);
      let cached = this.tools.get(item.value);
      if (!cached || cached.width !== width || cached.output !== output) {
        cached = {width, output, rows: lines(itemDetails(item, output), width)};
        this.tools.set(item.value, cached);
      }
      return cached.rows;
    };
    if (state.failedItem) add(format(state.failedItem));
    add(lines(counts(state), width));
    const activity = [...state.activities.values()].map(agent => `${agent.name} · ${agent.text}`).join('\n');
    if (activity) add(lines(activity, width));
    for (const item of state.items) {
      if (item === state.failedItem || item.value.type === 'userMessage'
        || item.threadId === state.threadId && item.value.type === 'agentMessage') continue;
      add(format(item));
    }
    for (const key of this.logs.keys()) if (!state.details.has(key)) this.logs.delete(key);
    for (const [title, text] of state.details) {
      let cached = this.logs.get(title);
      if (!cached || cached.width !== width || cached.text !== text) {
        cached = {width, text, rows: lines(`${title.replace(/^(Notice|Approval) \d+$/, '$1')}\n${text}`, width)};
        this.logs.set(title, cached);
      }
      add(cached.rows);
    }
    return blocks(parts);
  }
}
