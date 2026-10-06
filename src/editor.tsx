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
    }
  }, [value]);
  const update = () => {
    const rl = editor.current!;
    onChange(rl.line);
    setCursor(rl.cursor);
  };
  const insert = (text: string) => {
    const rl = editor.current!;
    const safe = clean(text);
    // readline treats newlines as submission; pasted text must remain one message.
    Object.assign(rl, {line: rl.line.slice(0, rl.cursor) + safe + rl.line.slice(rl.cursor), cursor: rl.cursor + safe.length});
    update();
  };
  usePaste(insert, {isActive: !disabled});
  useInput((input, key) => {
    const rl = editor.current!;
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
    else if (input.includes('\n') || input.includes('\r')) {insert(input); return;}
    else rl.write(clean(input));
    update();
  }, {isActive: !disabled});
  const at = Math.min(cursor, value.length);
  const shown = secret ? '•'.repeat(value.length) : value;
  const rendered = lines(`> ${shown.slice(0, at)}${disabled ? '' : '▏'}${shown.slice(at)}`, width);
  const cursorLine = lines(`> ${shown.slice(0, at)}`, width).length - 1;
  return <Box height={3} flexDirection="column"><Text color="cyan">{rendered.slice(Math.max(0, cursorLine - 2), Math.max(0, cursorLine - 2) + 3).join('\n')}</Text></Box>;
}
