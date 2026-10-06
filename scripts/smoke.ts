/** Exercise installed Codex against a local fake model; no requests go to a paid provider. */
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {RpcClient, codexVersion} from '../src/rpc.js';
import {Session} from '../src/session.js';
import {parseOptions} from '../src/args.js';
import {conversation} from '../src/view.js';

const home = await mkdtemp(join(tmpdir(), 'hush-smoke-'));
let requests = 0;
const model = createServer(async (req, res) => {
  for await (const _ of req) { /* Drain input; never store prompt contents. */ }
  if (!req.url?.endsWith('/responses')) {res.writeHead(404).end(); return;}
  requests++;
  const message = {id: `msg_${requests}`, type: 'message', status: 'completed', role: 'assistant', phase: 'final_answer', content: [{type: 'output_text', text: 'Hush smoke answer.', annotations: []}]};
  res.writeHead(200, {'content-type': 'text/event-stream', 'connection': 'close'});
  const events = [
    {type: 'response.created', response: {id: `resp_${requests}`, status: 'in_progress', output: []}},
    {type: 'response.output_item.added', output_index: 0, item: {...message, status: 'in_progress', content: []}},
    {type: 'response.content_part.added', item_id: message.id, output_index: 0, content_index: 0, part: {type: 'output_text', text: '', annotations: []}},
    {type: 'response.output_text.delta', item_id: message.id, output_index: 0, content_index: 0, delta: 'Hush smoke answer.'},
    {type: 'response.output_text.done', item_id: message.id, output_index: 0, content_index: 0, text: 'Hush smoke answer.'},
    {type: 'response.output_item.done', output_index: 0, item: message},
    {type: 'response.completed', response: {id: `resp_${requests}`, status: 'completed', output: [message], usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2}}},
  ];
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
});
let rpc: RpcClient | undefined;
try {
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const port = (model.address() as {port: number}).port;
  const args = ['app-server', '--listen', 'stdio://',
    '-c', 'model_provider="hush_smoke"', '-c', 'model="hush-test"',
    '-c', 'model_providers.hush_smoke.name="Hush smoke"',
    '-c', `model_providers.hush_smoke.base_url="http://127.0.0.1:${port}/v1"`,
    '-c', 'model_providers.hush_smoke.wire_api="responses"',
    '-c', 'model_providers.hush_smoke.requires_openai_auth=false',
    '-c', 'model_providers.hush_smoke.supports_websockets=false'];
  const connect = async () => {
    const connection = new RpcClient('codex', args, home, {...process.env, CODEX_HOME: home}, 30_000);
    connection.on('fault', error => console.error(error.message));
    connection.on('request', request => connection.reject(request.id, 'Smoke test does not approve actions.'));
    await connection.request('initialize', {clientInfo: {name: 'hush_smoke', version: '0.1.0', title: 'Hush smoke test'}, capabilities: {experimentalApi: true, requestAttestation: false}});
    connection.notify('initialized');
    return connection;
  };
  const version = await codexVersion();
  const resumedDirectory = join(home, 'resumed-project');
  await mkdir(resumedDirectory);
  for (const historyMode of ['legacy', 'paginated'] as const) {
    rpc = await connect();
    const created = await rpc.request('thread/start', {cwd: home, historyMode});
    assert.ok(created.thread.id);
    const completed = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Smoke turn timed out')), 30_000);
      rpc!.on('notification', event => {
        if (event.method === 'turn/completed') {clearTimeout(timer); resolve(event.params.turn);}
      });
    });
    await rpc.request('turn/start', {threadId: created.thread.id, input: [{type: 'text', text: 'Say hello.', text_elements: []}]});
    const turn = await completed;
    assert.equal(turn.status, 'completed', JSON.stringify(turn.error));
    await rpc.request('thread/name/set', {threadId: created.thread.id, name: 'Hush smoke saved'});
    await rpc.close();
    rpc = new RpcClient('codex', args, home, {...process.env, CODEX_HOME: home}, 30_000);
    const session = new Session(rpc, parseOptions(['resume', created.thread.id, '-m', 'hush-overridden', '-c', 'model_reasoning_effort="low"'], resumedDirectory));
    await session.start();
    assert.equal(session.state.phase, 'ready', session.state.alerts.join('\n'));
    assert.equal(session.state.model, 'hush-overridden');
    assert.equal(session.state.name, 'Hush smoke saved');
    await session.rename('Hush smoke renamed');
    assert.match(conversation(session.state), /Hush smoke answer/);
    assert.match(conversation(session.state), /Say hello/);
    const sessions = await rpc.request('thread/list', {cwd: home, modelProviders: [], sortKey: 'updated_at'});
    assert.equal(sessions.data.find(thread => thread.id === created.thread.id)?.name, 'Hush smoke renamed');
    const resumed = await rpc.request('thread/resume', {threadId: created.thread.id, excludeTurns: true});
    assert.equal(resumed.reasoningEffort, 'low');
    assert.equal(resumed.cwd, resumedDirectory);
    assert.ok(resumed.runtimeWorkspaceRoots.includes(resumedDirectory), JSON.stringify(resumed.runtimeWorkspaceRoots));
    await session.stop();
    rpc = await connect();
    const named = await rpc.request('thread/resume', {threadId: created.thread.id, excludeTurns: true});
    assert.equal(named.thread.name, 'Hush smoke renamed');
    await rpc.close();
  }
  assert.equal(requests, 2);
  console.log(`${version}: handshake, streaming, restart, Hush resume, model/config overrides, session renaming across restarts, and session list passed for legacy and paginated history. Two local fake-model requests; no paid inference.`);
} finally {
  await rpc?.close();
  model.closeAllConnections();
  await new Promise<void>(resolve => model.close(() => resolve()));
  await rm(home, {recursive: true, force: true});
}
