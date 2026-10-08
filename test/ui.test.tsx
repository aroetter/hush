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
  assert.match(app.lastFrame()!, /── Details · scrolling here · Ctrl\+O close ─+/);
  assert.match(app.lastFrame()!, /Persistent conversation/);
  app.stdin.write('\x0f'); await settle();
  assert.doesNotMatch(app.lastFrame()!, /hidden-command/);
  assert.doesNotMatch(app.lastFrame()!, /── Details/);
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
  rpc.event('turn/started', {threadId: 'root', turn: {id: 'active'}});
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
    app.stdin.write('\r'); // An Enter arriving before the new frame cannot approve the old choice.
    await settle();
    assert.equal(rpc.replies.length, 0);
    app.stdin.write('\r'); await settle();
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

test('exit and /exit close Hush locally, including during an active turn', async () => {
  for (const command of ['exit', ' /exit ']) {
    const {rpc, session} = await ready();
    await session.send('work');
    const calls = rpc.calls.length;
    let exits = 0;
    const app = render(<App session={session} version="test" onExit={() => {exits++;}}/>);
    try {
      await settle();
      app.stdin.write(command); await settle();
      assert.equal(exits, 0);
      app.stdin.write('\r'); await settle();
      assert.equal(exits, 1);
      assert.equal(rpc.calls.length, calls, 'exit must not start or steer a model turn');
    } finally {app.unmount();}
  }
});

test('exit inside a longer message is ordinary conversation', async () => {
  const {rpc, session} = await ready();
  let exited = false;
  const app = render(<App session={session} version="test" onExit={() => {exited = true;}}/>);
  try {
    await settle();
    app.stdin.write('explain /exit'); await settle();
    app.stdin.write('\r'); await settle();
    assert.equal(exited, false);
    assert.equal(rpc.calls.at(-1)!.params.input[0].text, 'explain /exit');
  } finally {app.unmount();}
});

test('exit remains a literal answer to a pending question', async () => {
  const {rpc, session} = await ready();
  rpc.ask(88, 'item/tool/requestUserInput', {threadId: 'root', questions: [
    {id: 'word', question: 'Which word?', options: null, isSecret: false},
  ]});
  let exited = false;
  const app = render(<App session={session} version="test" onExit={() => {exited = true;}}/>);
  try {
    await settle();
    app.stdin.write('exit'); await settle();
    app.stdin.write('\r'); await settle();
    assert.equal(exited, false);
    assert.deepEqual(rpc.replies[0]?.result, {answers: {word: {answers: ['exit']}}});
  } finally {app.unmount();}
});

test('activity animates without reformatting chat, then stops for input and completion', async () => {
  const {rpc, session} = await ready();
  let reads = 0;
  item(rpc, {...agent('answer', ''), get text() {reads++; return 'Stable conversation';}});
  rpc.event('turn/started', {threadId: 'root', turn: {id: 'busy'}});
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle();
    const before = reads;
    const start = app.frames.length;
    await delay(300);
    const markers = new Set(app.frames.slice(start).map(frame => frame.match(/([|/\\-]) Codex · Working/)?.[1]).filter(Boolean));
    assert.ok(markers.size >= 2, 'working indicator must advance');
    assert.equal(reads, before, 'animation must not reformat conversation');
    rpc.ask(90, 'item/commandExecution/requestApproval', {threadId: 'root', turnId: 'busy', command: 'test', availableDecisions: ['accept', 'decline']});
    await settle();
    assert.match(app.lastFrame()!, /\? Codex · Waiting for your input/);
    const waiting = app.lastFrame();
    await delay(260);
    assert.equal(app.lastFrame(), waiting);
    session.respond(90, {decision: 'decline'});
    rpc.event('turn/completed', {threadId: 'root', turn: {id: 'busy', status: 'completed'}});
    await settle();
    assert.match(app.lastFrame()!, /· Codex · Ready/);
    const idle = app.lastFrame();
    await delay(260);
    assert.equal(app.lastFrame(), idle);
  } finally {app.unmount();}
});

test('subagent indicators stop on completion and disconnect', async () => {
  const {rpc, session} = await ready();
  item(rpc, {type: 'subAgentActivity', id: 'child-start', agentThreadId: 'child', agentPath: '/root/check', kind: 'started'});
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle();
    assert.match(app.lastFrame()!, /[|/\\-] Codex · 1 agent active · Agents working/);
    assert.doesNotMatch(app.lastFrame()!, /\/root\/check/);
    item(rpc, {type: 'subAgentActivity', id: 'child-end', agentThreadId: 'child', agentPath: '/root/check', kind: 'completed'});
    await settle();
    assert.match(app.lastFrame()!, /· Codex · Ready/);
    assert.doesNotMatch(app.lastFrame()!, /\/root\/check/);
    rpc.emit('fault', new Error('Connection lost'));
    await settle();
    assert.match(app.lastFrame()!, /· Codex · Disconnected/);
    const frame = app.lastFrame();
    await delay(260);
    assert.equal(app.lastFrame(), frame);
  } finally {app.unmount();}
});

test('/rename saves a session name without sending a model message', async () => {
  const {rpc, session} = await ready();
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle();
    app.stdin.write('/rename Willis browser QA'); await settle();
    app.stdin.write('\r'); await settle();
    assert.deepEqual(rpc.calls.at(-1), {method: 'thread/name/set', params: {threadId: 'root', name: 'Willis browser QA'}});
    assert.equal(rpc.calls.some(call => call.method === 'turn/start'), false);
    assert.match(app.lastFrame()!, /hush · \/project · test-model · Willis browser QA/);
    const handler = rpc.handler;
    rpc.handler = async (method, params) => {if (method === 'thread/name/set') throw new Error('Rename failed'); return handler(method, params);};
    app.stdin.write('/rename Another name'); await settle();
    app.stdin.write('\r'); await settle();
    assert.match(app.lastFrame()!, /Rename failed/);
    assert.match(app.lastFrame()!, /\/rename Another name/);
    assert.equal(session.state.name, 'Willis browser QA');
  } finally {app.unmount();}
});


test('one status row summarizes agents and Details makes expansion explicit', async () => {
  const {rpc, session} = await ready();
  rpc.event('turn/started', {threadId: 'root', turn: {id: 'active'}});
  for (let i = 0; i < 4; i++) rpc.event('thread/started', {thread: {id: `child${i}`, parentThreadId: 'root', agentNickname: `/root/worker_${i}`, status: {type: 'active'}}});
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle();
    assert.match(app.lastFrame()!, /Codex · 4 agents active · Working/);
    assert.match(app.lastFrame()!, /▸ Details · Ctrl\+O to expand/);
    assert.doesNotMatch(app.lastFrame()!, /\/root\/worker|changed files|commands|notice\(s\)/);
    app.stdin.write('\x0f'); await settle();
    assert.match(app.lastFrame()!, /\/root\/worker_3/);
    assert.match(app.lastFrame()!, /▾ Details · Ctrl\+O to close/);
    app.stdin.write('\x0f'); await settle();
    session.alert('A real failure'); await settle();
    assert.match(app.lastFrame()!, /! A real failure/);
    assert.match(app.lastFrame()!, /Ctrl\+L dismiss alert/);
    assert.doesNotMatch(app.lastFrame()!, /notice\(s\)/);
  } finally {app.unmount();}
});

test('scrolling up loads older history without moving the visible message; Ctrl+B never loads history', async () => {
  const {rpc, session} = await ready();
  item(rpc, agent('recent', 'Recent message'));
  session.state.historyCursor = 'older';
  let finish!: (value: unknown) => void;
  rpc.handler = async () => new Promise(resolve => {finish = resolve;});
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle();
    app.stdin.write('\x02'); await settle();
    assert.equal(session.state.loadingHistory, false);
    app.stdin.write('\x0f'); await settle();
    app.stdin.write('\x1b[5~'); await settle();
    assert.equal(session.state.loadingHistory, false);
    app.stdin.write('\x0f'); await settle();
    app.stdin.write('\x1b[5~'); await settle();
    assert.equal(session.state.loadingHistory, true);
    app.stdin.write('\x1b[5~'); await settle();
    assert.equal(rpc.calls.filter(c => c.method === 'thread/turns/list').length, 1);
    finish({data: [{id: 'old', status: 'completed', itemsView: 'full', items: [agent('old', 'Older message')]}], nextCursor: null});
    await settle();
    assert.match(app.lastFrame()!, /Recent message/);
    assert.doesNotMatch(app.lastFrame()!, /Older message/);
    app.stdin.write('\x1b[5~'); await settle();
    assert.match(app.lastFrame()!, /Older message/);
  } finally {app.unmount();}
});

test('standard editing shortcuts work without occupying footer tips', async () => {
  const {rpc, session} = await ready();
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle();
    assert.doesNotMatch(app.lastFrame()!, /Ctrl\+[ACDEKU]/);
    app.stdin.write('discard'); await settle();
    app.stdin.write('\x01'); await settle();
    app.stdin.write('\x0b'); await settle();
    app.stdin.write('keep'); await settle();
    app.stdin.write('\r'); await settle();
    assert.equal(rpc.calls.find(c => c.method === 'turn/start')!.params.input[0].text, 'keep');
  } finally {app.unmount();}
});

test('input history survives an approval without storing the approval answer', async () => {
  const {rpc, session} = await ready();
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle();
    app.stdin.write('Remember this message'); await settle();
    app.stdin.write('\r'); await settle();
    rpc.ask(41, 'item/commandExecution/requestApproval', {threadId: 'root', command: 'command', availableDecisions: ['accept', 'decline']});
    await settle();
    app.stdin.write('2'); await settle(); app.stdin.write('\r'); await settle();
    app.stdin.write('\x10'); await settle();
    assert.match(app.lastFrame()!, /> Remember this message/);
    assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
  } finally {app.unmount();}
});

test('automatic history loading reports failure and preserves the conversation', async () => {
  const {rpc, session} = await ready();
  item(rpc, agent('recent', 'Keep this message'));
  session.state.historyCursor = 'older';
  rpc.handler = async () => {throw new Error('History unavailable');};
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle(); app.stdin.write('\x1b[5~'); await settle();
    assert.match(app.lastFrame()!, /Keep this message/);
    assert.match(app.lastFrame()!, /History unavailable/);
    assert.match(app.lastFrame()!, /Ctrl\+L dismiss alert/);
    assert.equal(session.state.loadingHistory, false);
  } finally {app.unmount();}
});

test('Details opens at the failed command, not diagnostic notices, and follows a new failure', async () => {
  const {rpc, session} = await ready();
  const fail = (id: string, command: string, aggregatedOutput: string) => item(rpc,
    {type: 'commandExecution', id, command, cwd: '/project', status: 'completed', exitCode: 1, aggregatedOutput});
  fail('bad', 'check-server', 'Server connection refused');
  session.state.details.set('account/rateLimits/updated ', 'Unrelated account metadata\n'.repeat(50));
  session.state.details.set('Approval 9', 'Automatic approval review approved');
  session.state.details.set('Notice 10', 'Some notice');
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle();
    assert.doesNotMatch(app.lastFrame()!, /Command failed|Ctrl\+L dismiss alert/);
    assert.doesNotMatch(app.lastFrame()!, /\/rename NAME/);
    app.stdin.write('\x0f'); await settle();
    assert.match(app.lastFrame()!, /check-server\nExit: 1\nServer connection refused/);
    assert.doesNotMatch(app.lastFrame()!, /See details|Ctrl\+O for details|Unrelated account metadata/);
    app.stdin.write('\x1b[6~'); await settle();
    fail('bad2', 'another-check', 'Different failure'); await settle();
    assert.match(app.lastFrame()!, /another-check\nExit: 1\nDifferent failure/);
    app.stdin.write('\x0f'); await settle();
    app.stdin.write('\x0f'); await settle();
    assert.match(app.lastFrame()!, /Different failure/);
    app.stdin.write('\x0c'); await settle();
    assert.equal(session.state.failedItem?.value.id, 'bad2');
    assert.doesNotMatch(app.lastFrame()!, /Approval 9|Notice 10/);
  } finally {app.unmount();}
});

test('subagent progress updates overwrite one row without entering conversation', async () => {
  const {rpc, session} = await ready();
  rpc.event('turn/started', {threadId: 'root', turn: {id: 'work'}});
  item(rpc, agent('progress', 'Checking playback\non mobile screens', 'commentary'), true, 'child');
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle();
    assert.equal(app.lastFrame()!.split('\n').filter(line => line.includes('Checking playback')).length, 1);
    assert.match(app.lastFrame()!, /Working: Checking playback on mobile screens/);
    item(rpc, {type: 'reasoning', id: 'r', summary: [], content: []}, true, 'child'); await settle();
    assert.match(app.lastFrame()!, /Thinking: Checking playback on mobile screens/);
    item(rpc, agent('next', 'Running the final checks', 'commentary'), true, 'child'); await settle();
    assert.doesNotMatch(app.lastFrame()!, /Checking playback/);
    assert.match(app.lastFrame()!, /Working: Running the final checks/);
    app.stdin.write('\x0f'); await settle();
    app.stdin.write('\x1b[5~'); await settle();
    assert.match(app.lastFrame()!, /Checking playback/);
  } finally {app.unmount();}
});

test('editing and scrolling reuse formatted history; session changes refresh it', async () => {
  const {rpc, session} = await ready();
  item(rpc, agent('answer', 'Existing answer'));
  item(rpc, {type: 'commandExecution', id: 'cmd', command: 'example', cwd: '/p', status: 'completed', exitCode: 0, aggregatedOutput: 'Existing output'});
  let reads = 0;
  const answer = session.state.items.find(entry => entry.value.id === 'answer')!.value;
  const command = session.state.items.find(entry => entry.value.id === 'cmd')!.value;
  Object.defineProperty(answer, 'text', {get: () => {reads++; return 'Existing answer';}, configurable: true});
  Object.defineProperty(command, 'aggregatedOutput', {get: () => {reads++; return 'Existing output';}, configurable: true});
  const app = render(<App session={session} version="test" onExit={() => {}}/>);
  try {
    await settle();
    app.stdin.write('\x0f'); await settle();
    assert.match(app.lastFrame()!, /Existing output/);
    reads = 0;
    for (const key of ['h', 'i', '\x1b[D', '\x1b[5~']) {
      app.stdin.write(key); await settle();
    }
    assert.equal(reads, 0, 'draft edits and scrolling must not reformat session history');
    assert.match(app.lastFrame()!, /h▏i/);
    item(rpc, agent('new-answer', 'New answer'));
    item(rpc, {...command, aggregatedOutput: 'New output'});
    await settle();
    assert.ok(reads > 0);
    assert.match(app.lastFrame()!, /New answer/);
    app.stdin.write('\x1b[6~'); await settle();
    assert.match(app.lastFrame()!, /New output/);
  } finally {app.unmount();}
});
