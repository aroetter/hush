/** Verify the real subprocess transport without invoking Codex or a network service. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {RpcClient} from '../src/rpc.js';

function peer(mode: string, timeout = 1000): RpcClient {
  return new RpcClient(process.execPath, ['test/fixtures/server.mjs', mode], process.cwd(), process.env, timeout);
}
test('requests correlate out of order; server requests and stderr use separate channels', async () => {
  const rpc = peer('echo');
  const logs: string[] = [];
  rpc.on('log', text => logs.push(text));
  const request = once(rpc, 'request');
  const notification = once(rpc, 'notification');
  try {
    const first = rpc.request('initialize', {delay: 30} as any);
    const second = rpc.request('initialize', {delay: 0} as any);
    assert.deepEqual(await second, {echo: {delay: 0}});
    assert.deepEqual(await first, {echo: {delay: 30}});
    assert.equal((await request)[0].id, 'approval');
    assert.equal((await notification)[0].method, 'test/event');
    assert.match(logs.join(''), /diagnostic log/);
    rpc.respond('approval', {decision: 'decline'});
  } finally {await rpc.close();}
});
test('malformed JSON fails pending work visibly', async () => {
  const rpc = peer('malformed');
  const fault = once(rpc, 'fault');
  try {
    await assert.rejects(rpc.request('initialize', {} as any), /disconnected/);
    assert.match((await fault)[0].message, /Invalid app-server message/);
  } finally {await rpc.close();}
});
test('process exit rejects pending requests', async () => {
  const rpc = peer('exit');
  rpc.on('fault', () => {});
  try {await assert.rejects(rpc.request('initialize', {} as any), /exited \(7\)/);}
  finally {await rpc.close();}
});
test('timed-out work is not retried and the connection closes', async () => {
  const rpc = peer('timeout', 50);
  const fault = once(rpc, 'fault');
  try {
    await assert.rejects(rpc.request('initialize', {} as any), /no request was retried/);
    assert.match((await fault)[0].message, /avoid duplicate work/);
    await assert.rejects(rpc.request('initialize', {} as any), /disconnected/);
  } finally {await rpc.close();}
});
test('missing executable reports an actionable error', async () => {
  const rpc = new RpcClient('/no-such-hush-codex', [], process.cwd());
  rpc.on('fault', () => {});
  try {await assert.rejects(rpc.request('initialize', {} as any), /ENOENT/);}
  finally {await rpc.close();}
});
