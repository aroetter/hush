/** Let Node's readline own editing and history; Ink alone owns the terminal. */
import React, {useLayoutEffect, useRef, useState} from 'react';
import {createInterface, type Interface, type Key as ReadlineKey} from 'node:readline';
import {PassThrough, Writable} from 'node:stream';
import {Box, Text, useInput, usePaste} from 'ink';
import {clean, lines} from './terminal.js';

export function Editor({value, onChange, onSubmit, disabled, secret, width, history}: {
  value: string; onChange: (text: string) => void; onSubmit: (text: string) => void;
  disabled: boolean; secret: boolean; width: number; history?: {current: string[]};
}): React.JSX.Element {
  const editor = useRef<Interface | null>(null);
  const [cursor, setCursor] = useState(value.length);
  const [pastes, setPastes] = useState<{start: number; end: number; expanded: boolean}[]>([]);
  const previous = useRef(value);
  useLayoutEffect(() => {
    const input = new PassThrough();
    const output = new Writable({write(_chunk, _encoding, done) {done();}});
    const rl = createInterface({input, output, terminal: true, historySize: secret ? 0 : 100, history: secret ? [] : history?.current, prompt: ''});
    if (history && !secret) rl.on('history', entries => {history.current = [...entries];});
    editor.current = rl;
    return () => {editor.current = null; rl.close(); input.destroy(); output.destroy();};
  }, [secret, history]);
  useLayoutEffect(() => {
    const rl = editor.current;
    if (rl && rl.line !== value) {
      // External clears and failed submissions must not enter readline's kill ring.
      Object.assign(rl, {line: value, cursor: value.length});
      setCursor(value.length);
      previous.current = value;
      setPastes([]);
    }
  }, [value]);
  const update = (edit?: {start: number; end: number}) => {
    const rl = editor.current!;
    const before = previous.current;
    const after = rl.line;
    const at = rl.cursor;
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = before.length;
    let nextEnd = after.length;
    while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) {end--; nextEnd--;}
    if (edit) {start = edit.start; end = edit.end;}
    const delta = after.length - before.length;
    // Keep only untouched paste spans. Editing inside a paste reveals its text.
    setPastes(entries => entries.flatMap(paste => {
      if (before !== after && start < paste.end && end > paste.start) return [];
      const shifted = before !== after && end <= paste.start
        ? {...paste, start: paste.start + delta, end: paste.end + delta} : paste;
      return [{...shifted, expanded: shifted.expanded || (at > shifted.start && at < shifted.end)}];
    }));
    previous.current = after;
    onChange(after);
    setCursor(at);
  };
  const insert = (text: string, pasted = false) => {
    const rl = editor.current!;
    const safe = clean(text);
    const start = rl.cursor;
    // readline treats newlines as submission; pasted text must remain one message.
    Object.assign(rl, {line: rl.line.slice(0, rl.cursor) + safe + rl.line.slice(rl.cursor), cursor: rl.cursor + safe.length});
    update({start, end: start});
    if (pasted && !secret && (safe.split('\n').length >= 5 || safe.length >= 500)) {
      setPastes(entries => [...entries, {start, end: start + safe.length, expanded: false}].sort((a, b) => a.start - b.start));
    }
  };
  usePaste(text => insert(text, true), {isActive: !disabled});
  useInput((input, key) => {
    const rl = editor.current!;
    if (key.ctrl && input === 'g' && pastes.length) {
      const expand = pastes.some(paste => !paste.expanded);
      if (!expand) {
        const containing = pastes.find(paste => rl.cursor > paste.start && rl.cursor < paste.end);
        if (containing) {Object.assign(rl, {cursor: containing.end}); setCursor(rl.cursor);}
      }
      setPastes(entries => entries.map(paste => ({...paste, expanded: expand})));
      return;
    }
    if (key.tab || key.escape || key.pageUp || key.pageDown || key.super || key.hyper) return;
    // Application commands stay with App, including SIGTSTP to avoid suspending its private editor.
    if (key.ctrl && ['c', 'd', 'l', 'o', 'z'].includes(input)) return;
    if (key.return) {
      if (key.meta || key.shift) insert('\n');
      else if (rl.line.trim()) {
        const text = rl.line;
        const at = rl.cursor;
        rl.write('', {name: 'return'}); // readline records input history.
        Object.assign(rl, {line: text, cursor: at}); // Preserve input until submission succeeds.
        onSubmit(text);
      }
      return;
    }
    const name = key.leftArrow ? 'left' : key.rightArrow ? 'right' : key.upArrow ? 'up' : key.downArrow ? 'down'
      : key.home ? 'home' : key.end ? 'end' : key.backspace ? 'backspace' : key.delete ? 'delete' : input;
    if (key.ctrl || key.meta || name !== input) {
      const chord: ReadlineKey = {name, ctrl: key.ctrl, meta: key.meta, shift: key.shift};
      // Ink normalizes the two control codes used by readline for undo and redo.
      if (key.ctrl && input === '_') chord.sequence = '\x1f';
      if (key.ctrl && input === '^') chord.sequence = '\x1e';
      rl.write('', chord);
    } else if (input === '\x1f' || input === '\x1e') rl.write('', {sequence: input});
    else if (input.includes('\n') || input.includes('\r')) {insert(input, true); return;}
    else rl.write(clean(input));
    update();
  }, {isActive: !disabled});
  const at = Math.min(cursor, value.length);
  let shown = secret ? '•'.repeat(value.length) : value;
  let shownCursor = at;
  if (!secret) {
    for (const paste of [...pastes].reverse()) {
      if (paste.expanded) continue;
      const text = value.slice(paste.start, paste.end);
      const count = text.split('\n').length;
      const marker = count > 1 ? `[Pasted ${count} lines]` : `[Pasted ${text.length} characters]`;
      shown = shown.slice(0, paste.start) + marker + shown.slice(paste.end);
      if (at >= paste.end) shownCursor += marker.length - text.length;
      else if (at > paste.start) shownCursor = paste.start + marker.length;
    }
  }
  const rendered = lines(`> ${shown.slice(0, shownCursor)}${disabled ? '' : '▏'}${shown.slice(shownCursor)}`, width);
  const cursorLine = lines(`> ${shown.slice(0, shownCursor)}`, width).length - 1;
  const preview = !secret && pastes.length > 0;
  const height = preview ? 2 : 3;
  const first = Math.max(0, cursorLine - height + 1);
  return <Box height={3} flexDirection="column">
    <Text color="cyan">{rendered.slice(first, first + height).join('\n')}</Text>
    {preview && <Text color="gray" wrap="truncate-end">Ctrl+G {pastes.some(paste => !paste.expanded) ? 'expand' : 'collapse'} pasted text</Text>}
  </Box>;
}
