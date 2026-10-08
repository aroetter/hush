import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shortcutHints, details, activityStatus} from '../src/view.js';
import {ready, item, agent} from './helpers.js';

test('shortcut hints fit complete labels, including wide characters', () => {
  assert.equal(shortcutHints(5, ['abcdef', '界', 'x']), '界');
  assert.equal(shortcutHints(6, ['界', 'x']), '界 · x');
  assert.equal(shortcutHints(0, ['hint']), '');
});


test('diagnostic headings omit record numbers without deleting notices', async () => {
  const {session} = await ready();
  session.state.details.set('Approval 9', 'Approved message');
  session.state.details.set('Notice 10', 'Warning message');
  const text = details(session.state);
  assert.match(text, /Approval\nApproved message/);
  assert.match(text, /Notice\nWarning message/);
  assert.doesNotMatch(text, /Approval 9|Notice 10/);
});

test('failed commands use streamed output when final output is absent, or explain missing output', async () => {
  const {rpc, session} = await ready();
  rpc.event('item/commandExecution/outputDelta', {itemId: 'bad', delta: 'Streamed failure reason'});
  item(rpc, {type: 'commandExecution', id: 'bad', command: 'check', cwd: '/project', status: 'completed', exitCode: 1, aggregatedOutput: null});
  assert.match(details(session.state), /^Command · completed\nDirectory: \/project\ncheck\nExit: 1\nStreamed failure reason/);
  item(rpc, {type: 'commandExecution', id: 'empty', command: 'silent-check', cwd: '/project', status: 'completed', exitCode: 1, aggregatedOutput: ''});
  assert.match(details(session.state), /^Command · completed\nDirectory: \/project\nsilent-check\nExit: 1\n\[No command output was provided by Codex.\]/);
});

test('progress survives command completion, reasoning, and lifecycle notifications until replaced', async () => {
  const {rpc, session} = await ready();
  rpc.event('turn/started', {threadId: 'root', turn: {id: 'work'}});
  item(rpc, agent('update', 'Checking browser playback', 'commentary'));
  assert.equal(activityStatus(session.state).text, 'Working: Checking browser playback');
  item(rpc, {type: 'commandExecution', id: 'cmd', command: 'private-shell-command', status: 'completed', exitCode: 0});
  assert.equal(activityStatus(session.state).text, 'Working: Checking browser playback');
  item(rpc, {type: 'reasoning', id: 'reason', summary: [], content: []});
  assert.equal(activityStatus(session.state).text, 'Thinking: Checking browser playback');
  rpc.event('thread/status/changed', {threadId: 'root', status: {type: 'active', activeFlags: []}});
  assert.equal(activityStatus(session.state).text, 'Working: Checking browser playback');
  item(rpc, agent('next', 'Running the browser tests', 'commentary'));
  assert.equal(activityStatus(session.state).text, 'Working: Running the browser tests');
  rpc.event('turn/completed', {threadId: 'root', turn: {id: 'work', status: 'completed'}});
  assert.equal(activityStatus(session.state).text, 'Ready');
  rpc.event('turn/started', {threadId: 'root', turn: {id: 'next'}});
  assert.equal(activityStatus(session.state).text, 'Working');
});

test('specific tool activity is a fallback and never exposes raw shell commands', async () => {
  const {rpc, session} = await ready();
  rpc.event('turn/started', {threadId: 'root', turn: {id: 'work'}});
  const command = {type: 'commandExecution', id: 'read', command: 'private-shell-command', status: 'inProgress', commandActions: [{type: 'read', name: 'session.ts', path: '/project/session.ts'}]};
  item(rpc, command, false);
  assert.equal(activityStatus(session.state).text, 'Working: Reading session.ts');
  item(rpc, {...command, status: 'completed', exitCode: 0});
  assert.equal(activityStatus(session.state).text, 'Working: Read session.ts');
  item(rpc, {type: 'reasoning', id: 'r', summary: [], content: []});
  assert.equal(activityStatus(session.state).text, 'Thinking: Read session.ts');
  item(rpc, agent('update', 'Fixing the session lifecycle', 'commentary'));
  item(rpc, {...command, id: 'read2'}, false);
  assert.equal(activityStatus(session.state).text, 'Working: Fixing the session lifecycle');
});

test('latest active-agent commentary contributes to the single status row', async () => {
  const {rpc, session} = await ready();
  rpc.event('turn/started', {threadId: 'root', turn: {id: 'work'}});
  item(rpc, agent('root-progress', 'Reviewing the patch', 'commentary'));
  rpc.event('turn/started', {threadId: 'child', turn: {id: 'child-work'}});
  item(rpc, agent('child-progress', 'Testing mobile layout', 'commentary'), true, 'child', 'child-work');
  assert.equal(activityStatus(session.state).text, '1 agent active · Working: Testing mobile layout');
  item(rpc, {type: 'reasoning', id: 'reason', summary: [], content: []}, true, 'child', 'child-work');
  assert.equal(activityStatus(session.state).text, '1 agent active · Thinking: Testing mobile layout');
  item(rpc, agent('new-root', 'Checking the final results', 'commentary'));
  assert.equal(activityStatus(session.state).text, '1 agent active · Working: Checking the final results');
  rpc.event('turn/completed', {threadId: 'root', turn: {id: 'work', status: 'completed'}});
  assert.equal(activityStatus(session.state).text, '1 agent active · Thinking: Testing mobile layout');
  rpc.ask(91, 'item/commandExecution/requestApproval', {threadId: 'child', command: 'check', availableDecisions: ['accept', 'decline']});
  assert.equal(activityStatus(session.state).text, 'Waiting for your input');
  assert.equal(activityStatus(session.state).running, false);
  rpc.event('serverRequest/resolved', {requestId: 91});
  rpc.event('turn/completed', {threadId: 'child', turn: {id: 'child-work', status: 'completed'}});
  assert.equal(activityStatus(session.state).text, 'Ready');
});
