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
