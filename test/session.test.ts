/** Verify conversation routing, bidirectional requests, history, and lifecycle races. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ready, FakeConnection, agent, item} from './helpers.js';
import {Session} from '../src/session.js';
import {parseOptions} from '../src/args.js';
import {conversation, details, clean} from '../src/view.js';

test('all main-agent messages stay in conversation; commands stay in details', async () => {
  const {rpc, session} = await ready();
  item(rpc, agent('progress', 'Reading files', 'commentary'));
  item(rpc, {type: 'commandExecution', id: 'cmd', command: 'secret-command', cwd: '/project', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null}, false);
  rpc.event('item/commandExecution/outputDelta', {itemId: 'cmd', delta: 'private output'});
  item(rpc, agent('answer', 'The answer.'));
  item(rpc, {...agent('question', 'Which file?', 'commentary'), questions: [{title: 'Which file?', options: ['A', 'B']}]});
  assert.match(conversation(session.state), /The answer/);
  assert.match(conversation(session.state), /Reading files/);
  assert.match(conversation(session.state), /Which file/);
  assert.doesNotMatch(conversation(session.state), /secret-command|private output/);
  assert.match(details(session.state), /secret-command/);
  assert.match(details(session.state), /private output/);
});
test('streamed answer is replaced by completed item without duplication', async () => {
  const {rpc, session} = await ready();
  item(rpc, agent('answer', ''), false);
  rpc.event('item/agentMessage/delta', {threadId: 'root', turnId: 'turn-1', itemId: 'answer', delta: 'Hello'});
  assert.match(conversation(session.state), /Hello/);
  item(rpc, agent('answer', 'Hello world'));
  assert.equal(conversation(session.state), 'Codex\nHello world');
});
test('steering, deduplicated user echo, and interrupt keep the session open', async () => {
  const {rpc, session} = await ready();
  await session.send('First');
  const sent = rpc.calls.find(c => c.method === 'turn/start')!;
  item(rpc, {type: 'userMessage', id: 'user1', clientId: sent.params.clientUserMessageId, content: sent.params.input});
  assert.equal(conversation(session.state).match(/First/g)?.length, 1);
  await session.send('Correction');
  assert.equal(rpc.calls.at(-1)?.method, 'turn/steer');
  assert.equal(rpc.calls.at(-1)?.params.expectedTurnId, 'turn-1');
  await session.interrupt();
  assert.equal(rpc.calls.at(-1)?.method, 'turn/interrupt');
  rpc.event('turn/completed', {threadId: 'root', turn: {id: 'turn-1', status: 'interrupted'}});
  assert.equal(session.state.activeTurn, undefined);
  assert.equal(session.state.phase, 'ready');
  assert.match(session.state.alerts.join(' '), /interrupted/);
});
test('completion before turn/start response cannot resurrect a finished turn', async () => {
  const {rpc, session} = await ready();
  rpc.handler = async () => {
    rpc.event('turn/started', {threadId: 'root', turn: {id: 'fast'}});
    rpc.event('turn/completed', {threadId: 'root', turn: {id: 'fast', status: 'completed'}});
    return {turn: {id: 'fast'}};
  };
  await session.send('Fast');
  assert.equal(session.state.activeTurn, undefined);
});
test('failed sends are not retried and can be corrected by the user', async () => {
  const {rpc, session} = await ready();
  rpc.handler = async () => {throw new Error('Invalid model');};
  assert.equal(await session.send('Hello'), false);
  assert.equal(rpc.calls.filter(c => c.method === 'turn/start').length, 1);
  assert.doesNotMatch(conversation(session.state), /Hello/);
  assert.match(session.state.alerts.join(' '), /Invalid model/);
});
test('approvals require an explicit response and resolved requests disappear', async () => {
  const {rpc, session} = await ready();
  rpc.ask(2, 'item/commandExecution/requestApproval', {threadId: 'root', turnId: 'turn-1', command: 'rm file', availableDecisions: ['decline', 'cancel']});
  assert.equal(rpc.replies.length, 0);
  assert.equal(session.state.prompts[0]?.choices.length, 2);
  session.respond(2, session.state.prompts[0]!.choices[0]!.result);
  assert.deepEqual(rpc.replies, [{id: 2, result: {decision: 'decline'}}]);
  rpc.ask(3, 'item/tool/requestUserInput', {threadId: 'root', questions: [{id: 'a', question: 'Which?'}]});
  rpc.event('serverRequest/resolved', {threadId: 'root', requestId: 3});
  session.respond(3, {answers: {a: {answers: ['A']}}});
  assert.equal(rpc.replies.length, 1);
});
test('file approval shows diff; missing details disable acceptance', async () => {
  const {rpc, session} = await ready();
  rpc.ask(1, 'item/fileChange/requestApproval', {threadId: 'root', itemId: 'missing'});
  assert.ok(session.state.prompts[0]!.choices.every(c => !c.label.startsWith('Allow')));
  item(rpc, {type: 'fileChange', id: 'patch', status: 'inProgress', changes: [{path: 'a', diff: '-old\n+new', kind: {type: 'update'}}]}, false);
  rpc.ask(2, 'item/fileChange/requestApproval', {threadId: 'root', itemId: 'patch'});
  assert.match(session.state.prompts[1]!.body, /-old\n\+new/);
  assert.equal(session.state.prompts[1]!.choices[0]!.label, 'Allow once');
});
test('permission denial grants nothing and acceptance is limited to the turn', async () => {
  const {rpc, session} = await ready();
  rpc.ask(1, 'item/permissions/requestApproval', {threadId: 'root', permissions: {network: {enabled: true}, fileSystem: null}});
  assert.deepEqual(session.state.prompts[0]!.choices.map(c => c.result), [{permissions: {network: {enabled: true}}, scope: 'turn'}, {permissions: {}, scope: 'turn'}]);
});
test('unsupported requests are answered with errors and reported visibly', async () => {
  const {rpc, session} = await ready();
  rpc.ask(5, 'new/approval', {});
  assert.match(rpc.replies[0]!.error!, /does not support/);
  assert.match(session.state.alerts.join(' '), /No action was approved/);
});
test('resume pages history in order, loads omitted items, and applies cwd/model/config', async () => {
  const rpc = new FakeConnection();
  const session = new Session(rpc, parseOptions(['resume', 'saved', '-m', 'new-model', '-c', 'x=true'], '/new'));
  rpc.handler = async (method, params) => {
    if (method === 'initialize') return {};
    if (method === 'thread/resume') return {thread: {id: 'saved', turns: []}, model: 'new-model'};
    if (method === 'thread/turns/list') return params.cursor
      ? {data: [{id: 'older', status: 'completed', itemsView: 'full', items: [agent('a', 'Older')]}], nextCursor: null}
      : {data: [{id: 'recent', status: 'completed', itemsView: 'summary', items: []}], nextCursor: 'older-page'};
    if (method === 'thread/items/list') return params.cursor
      ? {data: [{item: agent('c', 'Recent B')}], nextCursor: null}
      : {data: [{item: agent('b', 'Recent A')}], nextCursor: 'item-page'};
  };
  await session.start();
  assert.equal(session.state.phase, 'ready');
  await session.loadHistory();
  assert.equal(conversation(session.state), 'Codex\nOlder\n\nCodex\nRecent A\n\nCodex\nRecent B');
  assert.deepEqual(rpc.calls.find(c => c.method === 'thread/resume')?.params, {cwd: '/new', model: 'new-model', config: {x: true}, threadId: 'saved', excludeTurns: true});
});
test('latest resume selects by updated time and directory, including all providers', async () => {
  const rpc = new FakeConnection();
  const session = new Session(rpc, parseOptions(['resume', '--last'], '/project'));
  const original = rpc.handler;
  rpc.handler = async (method, params) => method === 'thread/list' ? {data: [{id: 'latest'}], nextCursor: null} : original(method, params);
  await session.start();
  assert.deepEqual(rpc.calls.find(c => c.method === 'thread/list')?.params, {cwd: '/project', sortKey: 'updated_at', sortDirection: 'desc', modelProviders: [], limit: 50, cursor: null});
  assert.equal(rpc.calls.find(c => c.method === 'thread/resume')?.params.threadId, 'latest');
});
test('subagent items remain in details and update their own activity row', async () => {
  const {rpc, session} = await ready();
  item(rpc, agent('a', 'Child answer'), true, 'child');
  assert.doesNotMatch(conversation(session.state), /Child answer/);
  assert.match(details(session.state), /Child answer/);
  assert.equal(session.state.activities.get('child')?.text, 'Writing answer');
});
test('tool failures stay in details; disconnections stay visible and disable sending', async () => {
  const {rpc, session} = await ready();
  item(rpc, {type: 'commandExecution', id: 'bad', command: 'false', cwd: '/p', status: 'completed', aggregatedOutput: 'failure', exitCode: 1});
  assert.deepEqual(session.state.alerts, []);
  assert.equal(session.state.failedItem?.value.type, 'commandExecution');
  rpc.emit('fault', new Error('Disconnected'));
  assert.equal(session.state.phase, 'disconnected');
  assert.equal(await session.send('No'), false);
});
test('diagnostic log keywords stay in details while connection faults still alert', async () => {
  const {rpc, session} = await ready();
  await session.send('Work');
  const logs = ['ERROR temporary failure\n', 'fatal handler installed; panic handler installed\n'];
  let changes = 0;
  session.on('change', () => changes++);
  for (const log of logs) rpc.emit('log', log);
  assert.equal(changes, logs.length);
  assert.deepEqual(session.state.alerts, []);
  assert.equal(session.state.activeTurn, 'turn-1');
  assert.equal(session.state.details.get('App-server log'), logs.join(''));
  assert.match(details(session.state), /ERROR temporary failure/);
  rpc.emit('fault', new Error('Codex app-server exited (1)'));
  assert.equal(session.state.phase, 'disconnected');
  assert.match(session.state.alerts.join(' '), /Codex app-server exited \(1\)/);
  assert.equal(await session.send('More'), false);
});
test('terminal escape sequences cannot execute through displayed text', () => {
  assert.equal(clean('\x1b[31mhello\x1b[0m\x1b]52;c;YWJj\x07'), 'hello');
});

test('live events arriving during older history loading are not lost', async () => {
  const {rpc, session} = await ready();
  item(rpc, agent('recent', 'Recent'));
  session.state.historyCursor = 'old';
  rpc.handler = async method => {
    if (method === 'thread/turns/list') return {data: [{id: 'old-turn', status: 'completed', itemsView: 'summary', items: []}], nextCursor: null};
    if (method === 'thread/items/list') {
      item(rpc, agent('live', 'Live answer'));
      return {data: [{item: agent('old', 'Old answer')}], nextCursor: null};
    }
    return {};
  };
  await session.loadHistory();
  assert.equal(conversation(session.state), 'Codex\nOld answer\n\nCodex\nRecent\n\nCodex\nLive answer');
});
test('repeated history cursors fail visibly rather than loop', async () => {
  const {rpc, session} = await ready();
  rpc.handler = async method => method === 'thread/turns/list'
    ? {data: [{id: 'old', items: [], itemsView: 'summary', status: 'completed'}], nextCursor: null}
    : {data: [], nextCursor: 'same'};
  await assert.rejects(session.loadHistory(), /repeated history cursor/);
  assert.equal(session.state.loadingHistory, false);
});
test('turn completion removes only prompts for that turn', async () => {
  const {rpc, session} = await ready();
  rpc.ask(1, 'item/commandExecution/requestApproval', {threadId: 'root', turnId: 'one', command: 'a'});
  rpc.ask(2, 'item/commandExecution/requestApproval', {threadId: 'child', turnId: 'two', command: 'b'});
  rpc.event('turn/completed', {threadId: 'root', turn: {id: 'one', status: 'interrupted'}});
  assert.deepEqual(session.state.prompts.map(p => p.id), [2]);
});
test('MCP forms and URLs preserve explicit consent; unsupported extensions report errors', async () => {
  const {rpc, session} = await ready();
  rpc.ask(1, 'mcpServer/elicitation/request', {threadId: 'root', serverName: 'service', mode: 'url', message: 'Log in', url: 'https://example.test/login'});
  assert.match(session.state.prompts[0]!.body, /https:\/\/example.test\/login/);
  assert.equal(rpc.replies.length, 0);
  rpc.ask(2, 'mcpServer/elicitation/request', {threadId: 'root', serverName: 'service', mode: 'form', requestedSchema: {type: 'object'}});
  assert.equal(session.state.prompts[1]!.form, true);
  rpc.ask(3, 'mcpServer/elicitation/request', {threadId: 'root', mode: 'openai/userVerification'});
  assert.match(rpc.replies[0]!.error!, /does not support/);
});

test('Ctrl+C during pending turn/start interrupts as soon as the turn is known', async () => {
  const {rpc, session} = await ready();
  let resolve!: (value: any) => void;
  rpc.handler = async method => method === 'turn/start' ? new Promise(r => {resolve = r;}) : {};
  const sending = session.send('Start slowly');
  await session.interrupt();
  assert.equal(session.state.interrupting, true);
  resolve({turn: {id: 'slow'}});
  await sending;
  assert.deepEqual(rpc.calls.at(-1), {method: 'turn/interrupt', params: {threadId: 'root', turnId: 'slow'}});
});
test('failed picker resume returns to picker so another session can be selected', async () => {
  const {rpc, session} = await ready();
  session.state.sessions = [{id: 'deleted'} as any];
  rpc.handler = async () => {throw new Error('No rollout found');};
  await assert.rejects(session.open('deleted'), /No rollout/);
  assert.equal(session.state.phase, 'picking');
});
test('quit requests interruption before closing the private server', async () => {
  const {rpc, session} = await ready();
  await session.send('Work');
  await session.stop();
  assert.equal(rpc.calls.at(-1)?.method, 'turn/interrupt');
});

test('file approvals use the latest patch update, not the initial patch', async () => {
  const {rpc, session} = await ready();
  item(rpc, {type: 'fileChange', id: 'patch', status: 'inProgress', changes: [{path: 'file', diff: '+initial', kind: {type: 'update'}}]}, false);
  rpc.event('item/fileChange/patchUpdated', {threadId: 'root', turnId: 'turn-1', itemId: 'patch', changes: [{path: 'file', diff: '+updated', kind: {type: 'update'}}]});
  rpc.ask(1, 'item/fileChange/requestApproval', {threadId: 'root', turnId: 'turn-1', itemId: 'patch'});
  assert.match(session.state.prompts[0]!.body, /\+updated/);
  assert.doesNotMatch(session.state.prompts[0]!.body, /\+initial/);
});
test('a disconnected startup cannot become ready when its last response arrives', async () => {
  const rpc = new FakeConnection();
  const original = rpc.handler;
  rpc.handler = async (method, params) => {
    const response = await original(method, params);
    if (method === 'thread/start') rpc.emit('fault', new Error('Connection lost'));
    return response;
  };
  const session = new Session(rpc, parseOptions([], '/project'));
  await session.start();
  assert.equal(session.state.phase, 'disconnected');
  assert.equal(await session.send('Should not send'), false);
});
test('failed history page hydration leaves existing history unchanged', async () => {
  const {rpc, session} = await ready();
  item(rpc, agent('recent', 'Recent answer'));
  rpc.handler = async method => {
    if (method === 'thread/turns/list') return {data: [
      {id: 'middle', status: 'completed', itemsView: 'summary', items: []},
      {id: 'oldest', status: 'completed', itemsView: 'full', items: [agent('oldest-answer', 'Oldest answer')]},
    ], nextCursor: null};
    throw new Error('History fetch failed');
  };
  await assert.rejects(session.loadHistory(), /History fetch failed/);
  assert.equal(conversation(session.state), 'Codex\nRecent answer');
});

test('a changed pending patch requires a fresh decision for the new revision', async () => {
  const {rpc, session} = await ready();
  item(rpc, {type: 'fileChange', id: 'patch', status: 'inProgress', changes: [{path: 'file', diff: '+old', kind: {type: 'update'}}]}, false);
  rpc.ask(1, 'item/fileChange/requestApproval', {threadId: 'root', itemId: 'patch'});
  const before = session.state.prompts[0]!;
  rpc.event('item/fileChange/patchUpdated', {threadId: 'root', turnId: 'turn-1', itemId: 'patch', changes: [{path: 'file', diff: '+new', kind: {type: 'update'}}]});
  const after = session.state.prompts[0]!;
  assert.match(after.body, /\+new/);
  session.respond(before.id, before.choices[0]!.result, before.revision);
  assert.equal(rpc.replies.length, 0);
  session.respond(after.id, after.choices[0]!.result, after.revision);
  assert.deepEqual(rpc.replies, [{id: 1, result: {decision: 'accept'}}]);
});

test('routine approval notices stay in details while denied and unknown warnings stay visible', async () => {
  const {rpc, session} = await ready();
  for (const method of ['guardianWarning', 'warning']) {
    rpc.event(method, {threadId: 'root', message: 'Automatic approval review approved (risk: low, authorization: high): Run checks.'});
  }
  assert.deepEqual(session.state.alerts, []);
  assert.match(details(session.state), /Automatic approval review approved/);
  rpc.event('guardianWarning', {threadId: 'root', message: 'Automatic approval review denied: permission required.'});
  rpc.event('warning', {message: 'Something unexpected'});
  assert.equal(session.state.alerts.length, 2);
  assert.match(session.state.alerts[0]!, /denied/);
});

test('historical failures remain in details without new failure banners', async () => {
  const {rpc, session} = await ready();
  rpc.handler = async method => method === 'thread/turns/list' ? {data: [{id: 'old', status: 'failed', itemsView: 'full', error: {message: 'Old turn failed'}, items: [
    {type: 'commandExecution', id: 'old-command', command: 'false', cwd: '/project', status: 'completed', exitCode: 1, aggregatedOutput: 'Old command output'},
  ]}], nextCursor: null} : {};
  await session.loadHistory();
  assert.deepEqual(session.state.alerts, []);
  assert.match(details(session.state), /Old command output/);
  assert.match(details(session.state), /Old turn failed/);
  item(rpc, {type: 'commandExecution', id: 'new-command', command: 'false', cwd: '/project', status: 'completed', exitCode: 1});
  assert.deepEqual(session.state.alerts, []);
  assert.equal(session.state.failedItem?.value.type, 'commandExecution');
});

test('rename validates names and tracks external name updates', async () => {
  const {rpc, session} = await ready();
  const count = rpc.calls.length;
  await assert.rejects(session.rename('  '), /Usage: \/rename/);
  assert.equal(rpc.calls.length, count);
  await session.rename('  Named session  ');
  assert.equal(session.state.name, 'Named session');
  rpc.event('thread/name/updated', {threadId: 'root', threadName: 'Renamed elsewhere'});
  assert.equal(session.state.name, 'Renamed elsewhere');
});

test('failed attempts and retries stay quiet, while failed turns and connection errors alert', async () => {
  const {rpc, session} = await ready();
  rpc.event('turn/started', {threadId: 'root', turn: {id: 'work'}});
  item(rpc, {type: 'commandExecution', id: 'attempt', command: 'browser-check', cwd: '/project', status: 'completed', exitCode: 1, aggregatedOutput: 'Chrome launch failed'}, true, 'root', 'work');
  rpc.event('error', {threadId: 'root', willRetry: true, error: {message: 'Temporary provider problem'}});
  item(rpc, {type: 'commandExecution', id: 'retry', command: 'other-check', cwd: '/project', status: 'completed', exitCode: 0, aggregatedOutput: 'Checks completed'}, true, 'root', 'work');
  rpc.event('turn/completed', {threadId: 'root', turn: {id: 'work', status: 'completed'}});
  assert.deepEqual(session.state.alerts, []);
  assert.match(details(session.state), /Chrome launch failed/);
  assert.match(details(session.state), /Temporary provider problem/);
  assert.equal(session.state.failedItem?.value.id, 'attempt');
  rpc.event('turn/started', {threadId: 'root', turn: {id: 'next'}});
  assert.equal(session.state.failedItem, undefined);
  assert.match(details(session.state), /Chrome launch failed/);
  rpc.event('turn/completed', {threadId: 'root', turn: {id: 'next', status: 'failed', error: {message: 'Task could not finish'}}});
  assert.match(session.state.alerts.join(' '), /Task could not finish/);
  rpc.emit('fault', new Error('Connection lost'));
  assert.match(session.state.alerts.join(' '), /Connection lost/);
});

test('file and tool failures remain inspectable without persistent warnings', async () => {
  const {rpc, session} = await ready();
  for (const value of [
    {type: 'fileChange', id: 'patch-failed', status: 'failed', changes: []},
    {type: 'mcpToolCall', id: 'mcp-failed', tool: 'browser', error: {message: 'Browser unavailable'}},
    {type: 'dynamicToolCall', id: 'tool-failed', tool: 'check', success: false, status: 'failed'},
  ]) {
    item(rpc, value);
    assert.equal(session.state.failedItem?.value.id, value.id);
    assert.deepEqual(session.state.alerts, []);
  }
  assert.match(details(session.state), /Browser unavailable/);
});

test('main-agent commentary and unclassified messages stream without waiting for completion', async () => {
  for (const phase of ['commentary', null]) {
    const {rpc, session} = await ready();
    item(rpc, {...agent('reply', '', phase ?? undefined), phase}, false);
    rpc.event('item/agentMessage/delta', {threadId: 'root', turnId: 'turn-1', itemId: 'reply', delta: 'You can merge these now'});
    assert.match(conversation(session.state), /You can merge these now/);
    item(rpc, {...agent('reply', 'You can merge these now: #150.', phase ?? undefined), phase});
    assert.equal(conversation(session.state), 'Codex\nYou can merge these now: #150.');
    item(rpc, agent('child-reply', 'Private child update', 'commentary'), true, 'child');
    item(rpc, {type: 'reasoning', id: 'reasoning', summary: ['Private reasoning'], content: []});
    assert.doesNotMatch(conversation(session.state), /Private/);
    assert.match(details(session.state), /Private child update|Private reasoning/);
  }
});

test('resume shows saved commentary replies in conversation', async () => {
  const rpc = new FakeConnection();
  const original = rpc.handler;
  rpc.handler = async (method, params) => method === 'thread/turns/list'
    ? {data: [{id: 'saved-turn', status: 'completed', itemsView: 'full', items: [agent('saved-reply', 'Leave the draft PRs alone.', 'commentary')]}], nextCursor: null}
    : original(method, params);
  const session = new Session(rpc, parseOptions(['resume', 'root'], '/project'));
  await session.start();
  assert.equal(conversation(session.state), 'Codex\nLeave the draft PRs alone.');
});
