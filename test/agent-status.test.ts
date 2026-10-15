import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {ready, item, agent} from './helpers.js';
import {activityStatus} from '../src/view.js';

const interaction = (rpc: Awaited<ReturnType<typeof ready>>['rpc'], kind = 'interacted') =>
  item(rpc, {type: 'subAgentActivity', id: `child-${kind}`, agentThreadId: 'child', agentPath: '/root/check', kind});

test('an interaction with an idle agent does not claim active work', async () => {
  const {rpc, session} = await ready();
  rpc.handler = async () => ({thread: {id: 'child', status: {type: 'idle'}}});
  interaction(rpc);
  assert.equal(activityStatus(session.state).running, false);
  assert.match(activityStatus(session.state).text, /status unknown/);
  await flush();
  assert.equal(activityStatus(session.state).text, 'Ready');
  assert.deepEqual(rpc.calls.at(-1)?.params, {threadId: 'child', includeTurns: false});
  await session.stop();
});

test('periodic reads remove stale active counts when completion events are missing', async t => {
  const {rpc, session} = await ready();
  t.mock.timers.enable({apis: ['setInterval', 'setTimeout']});
  let status: any = {type: 'active', activeFlags: []};
  rpc.handler = async () => ({thread: {id: 'child', status}});
  try {
    interaction(rpc, 'started'); await flush();
    assert.match(activityStatus(session.state).text, /1 agent active/);
    status = {type: 'idle'};
    t.mock.timers.tick(10_000); await flush();
    assert.equal(activityStatus(session.state).text, 'Ready');
    assert.equal(activityStatus(session.state).running, false);
    const reads = rpc.calls.length;
    t.mock.timers.tick(30_000); await flush();
    assert.equal(rpc.calls.length, reads, 'idle agents need no more polling');
  } finally {await session.stop(); t.mock.timers.reset();}
});

test('new completion events override older status snapshots; late output cannot resurrect a finished turn', async () => {
  const {rpc, session} = await ready();
  let finish!: (value: any) => void;
  rpc.handler = async () => new Promise(resolve => {finish = resolve;});
  interaction(rpc);
  rpc.event('turn/completed', {threadId: 'child', turn: {id: 'child-turn', status: 'completed'}});
  finish({thread: {id: 'child', status: {type: 'active', activeFlags: []}}}); await flush();
  item(rpc, agent('late', 'Finished'), true, 'child', 'child-turn');
  assert.equal(activityStatus(session.state).text, 'Ready');
  await session.stop();
});

test('failed, unloaded, or stalled status reads show unknown instead of a permanent active count', async t => {
  const {rpc, session} = await ready();
  t.mock.timers.enable({apis: ['setInterval', 'setTimeout']});
  let mode = 'active';
  let finish!: (value: any) => void;
  rpc.handler = async () => {
    if (mode === 'failure') throw new Error('Unavailable');
    if (mode === 'stall') return new Promise(resolve => {finish = resolve;});
    return {thread: {id: 'child', status: {type: mode === 'unloaded' ? 'notLoaded' : 'active', activeFlags: []}}};
  };
  try {
    interaction(rpc); await flush();
    mode = 'failure'; t.mock.timers.tick(10_000); await flush();
    assert.match(activityStatus(session.state).text, /status unknown/);
    assert.equal(activityStatus(session.state).running, false);
    assert.deepEqual(session.state.alerts, []);
    mode = 'unloaded'; t.mock.timers.tick(10_000); await flush();
    assert.match(activityStatus(session.state).text, /status unknown/);
    mode = 'active'; t.mock.timers.tick(10_000); await flush();
    assert.match(activityStatus(session.state).text, /1 agent active/);
    mode = 'stall'; t.mock.timers.tick(10_000); await flush();
    t.mock.timers.tick(5000); await flush();
    assert.match(activityStatus(session.state).text, /status unknown/);
    finish({thread: {id: 'child', status: {type: 'idle'}}}); await flush();
    assert.equal(activityStatus(session.state).text, 'Ready');
  } finally {await session.stop(); t.mock.timers.reset();}
});

test('root completion reconciles children without assuming they stopped; shutdown cancels polling', async t => {
  const {rpc, session} = await ready();
  t.mock.timers.enable({apis: ['setInterval', 'setTimeout']});
  try {
    interaction(rpc); await flush();
    rpc.event('turn/completed', {threadId: 'root', turn: {id: 'parent', status: 'completed'}}); await flush();
    assert.match(activityStatus(session.state).text, /1 agent active/);
    await session.stop();
    const reads = rpc.calls.length;
    t.mock.timers.tick(30_000); await flush();
    assert.equal(rpc.calls.length, reads);
  } finally {t.mock.timers.reset();}
});
