import React, {useState} from 'react';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {render} from 'ink-testing-library';
import {Editor} from '../src/editor.js';

function input(secret = false) {
  let text = '';
  const submitted: string[] = [];
  function Harness() {
    const [value, setValue] = useState('');
    return <Editor value={value} onChange={v => {text = v; setValue(v);}}
      onSubmit={v => {submitted.push(v); text = ''; setValue('');}} disabled={false} secret={secret} width={60}/>;
  }
  const app = render(<Harness/>);
  const key = async (value: string) => {app.stdin.write(value); await delay(40);};
  return {app, key, submitted, value: () => text};
}

test('readline handles character/word movement, deletion, kill/yank, and undo/redo', async () => {
  const {app, key, value} = input();
  try {
    await delay(40);
    await key('one two');
    await key('\x01'); // start
    await key('\x06'); // forward character
    await key('\x02'); // backward character
    await key('\x1bf'); // forward word
    await key('\x0b'); // kill rest
    assert.equal(value(), 'one ');
    await key('\x19'); // yank
    assert.equal(value(), 'one two');
    await key('\x1bb'); // backward word
    await key('\x1bd'); // delete word
    assert.equal(value(), 'one ');
    await key('\x17'); // delete previous word
    assert.equal(value(), '');
    await key('undo');
    await key('\x1f');
    assert.equal(value(), '');
    await key('\x1e');
    assert.equal(value(), 'undo');
    await key('\x05'); // end
    await key('\x15'); // kill to start
    assert.equal(value(), '');
    await key('\x19');
    assert.equal(value(), 'undo');
    await key('\x08'); // delete left
    assert.equal(value(), 'und');
  } finally {app.unmount();}
});

test('readline recalls submitted input without automatically submitting it', async () => {
  const {app, key, submitted, value} = input();
  try {
    await delay(40);
    await key('first'); await key('\r');
    await key('second'); await key('\r');
    await key('\x10');
    assert.equal(value(), 'second');
    await key('\x10');
    assert.equal(value(), 'first');
    await key('\x0e');
    assert.equal(value(), 'second');
    assert.deepEqual(submitted, ['first', 'second']);
  } finally {app.unmount();}
});

test('secret input is masked and never recorded in readline history', async () => {
  const {app, key, value, submitted} = input(true);
  try {
    await delay(40);
    await key('secret-value');
    await key('\x15'); await key('\x19');
    assert.equal(value(), 'secret-value');
    await key('\r'); await key('\x10');
    assert.equal(value(), '');
    assert.deepEqual(submitted, ['secret-value']);
    assert.ok(app.frames.every(frame => !frame.includes('secret-value')));
  } finally {app.unmount();}
});

const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;

test('long pastes collapse, expand, and submit full text with surrounding input', async () => {
  const {app, key, submitted, value} = input();
  const text = 'alpha\nbeta\ngamma\ndelta\nepsilon';
  try {
    await delay(40);
    await key('Please read: ');
    await key(paste(text));
    assert.match(app.lastFrame()!, /Please read: \[Pasted 5 lines\]/);
    assert.match(app.lastFrame()!, /Ctrl\+G expand/);
    assert.deepEqual(submitted, []);
    await key(' then explain.');
    assert.equal(value(), `Please read: ${text} then explain.`);
    await key('\x07');
    assert.match(app.lastFrame()!, /epsilon then explain/);
    assert.match(app.lastFrame()!, /Ctrl\+G collapse/);
    assert.doesNotMatch(app.lastFrame()!, /\[Pasted/);
    await key('\x07');
    assert.match(app.lastFrame()!, /\[Pasted 5 lines\]/);
    await key('\r');
    assert.deepEqual(submitted, [`Please read: ${text} then explain.`]);
    assert.doesNotMatch(app.lastFrame()!, /Pasted|Ctrl\+G/);
    await key('\x10');
    assert.equal(value(), submitted[0]);
  } finally {app.unmount();}
});

test('multiple paste previews track edits before them and reveal edits inside them', async () => {
  const {app, key, submitted, value} = input();
  const first = 'one\ntwo\nthree\nfour\nfive';
  const second = 'six\nseven\neight\nnine\nten';
  try {
    await delay(40);
    await key(paste(first)); await key(' / '); await key(paste(second));
    assert.equal(app.lastFrame()!.match(/\[Pasted 5 lines\]/g)?.length, 2);
    await key('\x01'); await key('prefix ');
    assert.equal(app.lastFrame()!.match(/\[Pasted 5 lines\]/g)?.length, 2);
    await key('\x05'); await key('\x02');
    assert.match(app.lastFrame()!, /te▏n/);
    await key('X');
    assert.equal(value(), `prefix ${first} / six\nseven\neight\nnine\nteXn`);
    await key('\x01'); await key('\x0b');
    assert.equal(value(), '');
    assert.doesNotMatch(app.lastFrame()!, /Pasted|Ctrl\+G/);
    await key('\x19'); await key('\r');
    assert.equal(submitted[0], `prefix ${first} / six\nseven\neight\nnine\nteXn`);
  } finally {app.unmount();}
});

test('short pastes stay visible; long single lines collapse; secrets never reveal content', async () => {
  const normal = input();
  const secret = input(true);
  try {
    await delay(40);
    await normal.key(paste('short\npaste'));
    assert.match(normal.app.lastFrame()!, /short\npaste/);
    assert.doesNotMatch(normal.app.lastFrame()!, /Pasted/);
    await normal.key('\x15');
    const long = 'x'.repeat(500);
    await normal.key(paste(long));
    assert.match(normal.app.lastFrame()!, /\[Pasted 500 characters\]/);
    await normal.key('\r');
    assert.equal(normal.submitted[0], long);
    await secret.key(paste('hidden\n'.repeat(6)));
    await secret.key('\x07');
    assert.ok(secret.app.frames.every(frame => !/hidden|Pasted|Ctrl\+G/.test(frame)));
  } finally {normal.app.unmount(); secret.app.unmount();}
});

test('identical pastes inserted before a preview keep separate spans', async () => {
  const {app, key, value, submitted} = input();
  const text = 'x'.repeat(500);
  try {
    await delay(40);
    await key(paste(text));
    await key('\x01');
    await key(paste(text));
    assert.equal(app.lastFrame()!.match(/\[Pasted 500 characters\]/g)?.length, 2);
    assert.equal(value(), text + text);
    await key('\r');
    assert.deepEqual(submitted, [text + text]);
  } finally {app.unmount();}
});
