/** Exercise keyboard-driven conversation, details, approval, and question flows through Ink. */
import React from 'react';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {render} from 'ink-testing-library';
import {App} from '../src/ui.js';
import {ready, agent, item, FakeConnection} from './helpers.js';
import {Session} from '../src/session.js';
import {parseOptions} from '../src/args.js';

const settle = () => delay(40);
test('details toggle without moving commands into the conversation', async () => {
  const {rpc, session} = await ready();
  item(rpc, agent('answer', 'Persistent conversation'));
  item(rpc, {type: 'commandExecution', id: 'cmd', command: 'hidden-command', cwd: '/p', status: 'completed', exitCode: 0, aggregatedOutput: 'hidden-log'});
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  await settle();
  assert.match(app.lastFrame()!, /Persistent conversation/);
  assert.doesNotMatch(app.lastFrame()!, /hidden-command/);
  app.stdin.write('\x0f'); await settle();
  assert.match(app.lastFrame()!, /hidden-command/);
  assert.match(app.lastFrame()!, /Persistent conversation/);
  app.stdin.write('\x0f'); await settle();
  assert.doesNotMatch(app.lastFrame()!, /hidden-command/);
  app.unmount();
});
test('typing and Enter send once; Ctrl+C interrupts; Ctrl+D exits', async () => {
  const {rpc, session} = await ready();
  let exited = false;
  const app = render(<App session={session} version="test" onExit={() => {exited = true;}}/>);
  await settle();
  app.stdin.write('Hello'); await settle();
  app.stdin.write('\r'); await settle();
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
  assert.equal(rpc.calls.at(-1)!.params.input[0].text, 'Hello');
  app.stdin.write('\x03'); await settle();
  assert.equal(rpc.calls.at(-1)!.method, 'turn/interrupt');
  app.stdin.write('\x04'); await settle();
  assert.equal(exited, true);
  app.unmount();
});
test('approval is visible with details collapsed and requires an explicit numbered choice', async () => {
  const {rpc, session} = await ready();
  rpc.ask(1, 'item/commandExecution/requestApproval', {threadId: 'root', command: 'do-the-thing', availableDecisions: ['accept', 'decline']});
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  await settle();
  assert.match(app.lastFrame()!, /Command approval/);
  assert.equal(rpc.replies.length, 0);
  app.stdin.write('\r'); await settle();
  assert.equal(rpc.replies.length, 0);
  app.stdin.write('2'); await settle(); app.stdin.write('\r'); await settle();
  assert.deepEqual(rpc.replies, [{id: 1, result: {decision: 'decline'}}]);
  app.unmount();
});
test('multiple questions collect option labels and secret text without exposing secrets', async () => {
  const {rpc, session} = await ready();
  rpc.ask(8, 'item/tool/requestUserInput', {threadId: 'root', questions: [
    {id: 'choice', question: 'Pick one', options: [{label: 'A', description: 'Alpha'}, {label: 'B', description: 'Beta'}], isSecret: false},
    {id: 'secret', question: 'Secret?', options: null, isSecret: true},
  ]});
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  await settle();
  app.stdin.write('2'); await settle(); app.stdin.write('\r'); await settle();
  app.stdin.write('private-value'); await settle();
  assert.doesNotMatch(app.lastFrame()!, /private-value/);
  app.stdin.write('\r'); await settle();
  assert.deepEqual(rpc.replies[0]?.result, {answers: {choice: {answers: ['B']}, secret: {answers: ['private-value']}}});
  app.unmount();
});
test('resume picker selects a session with the keyboard', async () => {
  const rpc = new FakeConnection();
  const original = rpc.handler;
  rpc.handler = async (method, params) => method === 'thread/list' ? {data: [{id: 'one', name: 'First session', updatedAt: 1}, {id: 'two', name: 'Second session', updatedAt: 2}], nextCursor: null} : original(method, params);
  const session = new Session(rpc, parseOptions(['resume'], '/project'));
  await session.start();
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  await settle();
  assert.match(app.lastFrame()!, /First session/);
  app.stdin.write('\x1b[B'); await settle(); app.stdin.write('\r'); await settle();
  assert.equal(rpc.calls.find(c => c.method === 'thread/resume')?.params.threadId, 'two');
  app.unmount();
});

test('bracketed multiline paste stays in the draft until Enter', async () => {
  const {rpc, session} = await ready();
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  await settle();
  app.stdin.write('\x1b[200~first\nsecond\x1b[201~'); await settle();
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 0);
  app.stdin.write('\r'); await settle();
  assert.equal(rpc.calls.at(-1)?.params.input[0].text, 'first\nsecond');
  app.unmount();
});
test('scrolling conversation is stable while agent status changes', async () => {
  const {rpc, session} = await ready();
  item(rpc, agent('long', Array.from({length: 60}, (_, i) => `Line ${i}`).join('\n')));
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  await settle();
  assert.match(app.lastFrame()!, /Line 59/);
  app.stdin.write('\x1b[5~'); await settle();
  const before = app.lastFrame()!.match(/Line \d+/g);
  item(rpc, agent('progress2', 'New status', 'commentary')); await settle();
  assert.deepEqual(app.lastFrame()!.match(/Line \d+/g), before);
  assert.match(app.lastFrame()!, /New status/);
  app.unmount();
});
test('failed submissions preserve the draft for correction', async () => {
  const {rpc, session} = await ready();
  rpc.handler = async () => {throw new Error('Bad model');};
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  await settle(); app.stdin.write('Keep my message'); await settle(); app.stdin.write('\r'); await settle();
  assert.match(app.lastFrame()!, /Keep my message/);
  assert.match(app.lastFrame()!, /Bad model/);
  app.unmount();
});

test('Forward Delete removes the character after the cursor', async () => {
  const {rpc, session} = await ready();
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle(); app.stdin.write('abc'); await settle();
    app.stdin.write('\x1b[D'); await settle();
    app.stdin.write('\x1b[3~'); await settle();
    app.stdin.write('\r'); await settle();
    assert.equal(rpc.calls.at(-1)?.params.input[0].text, 'ab');
  } finally {app.unmount();}
});

test('a revised patch clears the typed approval choice', async () => {
  const {rpc, session} = await ready();
  item(rpc, {type: 'fileChange', id: 'patch', status: 'inProgress', changes: [{path: 'file', diff: '+old', kind: {type: 'update'}}]}, false);
  rpc.ask(1, 'item/fileChange/requestApproval', {threadId: 'root', itemId: 'patch'});
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle(); app.stdin.write('1'); await settle();
    rpc.event('item/fileChange/patchUpdated', {threadId: 'root', turnId: 'turn-1', itemId: 'patch', changes: [{path: 'file', diff: '+new', kind: {type: 'update'}}]});
    await settle(); app.stdin.write('\r'); await settle();
    assert.equal(rpc.replies.length, 0);
    assert.match(app.lastFrame()!, /\+new/);
    app.stdin.write('1'); await settle(); app.stdin.write('\r'); await settle();
    assert.deepEqual(rpc.replies, [{id: 1, result: {decision: 'accept'}}]);
  } finally {app.unmount();}
});

test('collapsed details do not format tool output on every keystroke', async () => {
  const {session} = await ready();
  let reads = 0;
  session.state.items.push({threadId: 'root', turnId: 'one', complete: true, value: {
    type: 'commandExecution', id: 'cmd', command: 'test', cwd: '/p', status: 'completed', exitCode: 0,
    get aggregatedOutput() {reads++; return 'large tool output';},
  } as any});
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle(); app.stdin.write('Draft'); await settle();
    assert.equal(reads, 0);
    app.stdin.write('\x0f'); await settle();
    assert.match(app.lastFrame()!, /large tool output/);
  } finally {app.unmount();}
});
