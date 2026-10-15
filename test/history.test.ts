import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HistoryFormatter} from '../src/history.js';
import {conversationLines, details, lines} from '../src/view.js';
import {ready, item, agent} from './helpers.js';

test('cached history matches existing formatting across updates, widths and failed tools', async () => {
  const {rpc, session} = await ready();
  const formatter = new HistoryFormatter();
  item(rpc, agent('one', '**First** reply'));
  item(rpc, agent('two', 'Second reply'));
  item(rpc, {type: 'commandExecution', id: 'cmd', command: 'check', cwd: '/p', status: 'completed', exitCode: 1, aggregatedOutput: 'output\nline two'});
  for (const width of [70, 35, 70]) {
    const chat = formatter.conversation(session.state, width);
    assert.deepEqual(chat.slice(0, chat.length), conversationLines(session.state, width));
    const technical = formatter.details(session.state, width);
    const expected = lines(details(session.state), width);
    assert.deepEqual(technical.slice(0, technical.length), expected);
    for (let start = 0; start < expected.length; start++) {
      assert.deepEqual(technical.slice(start, start + 4), expected.slice(start, start + 4));
    }
  }
  rpc.event('item/commandExecution/outputDelta', {itemId: 'cmd', delta: 'streamed'});
  item(rpc, {type: 'commandExecution', id: 'cmd', command: 'check', cwd: '/p', status: 'completed', exitCode: 1, aggregatedOutput: ''});
  const technical = formatter.details(session.state, 70);
  assert.deepEqual(technical.slice(0, technical.length), lines(details(session.state), 70));
});

test('tool and status events do not reformat unchanged history, even with Details open', async () => {
  const {rpc, session} = await ready();
  const formatter = new HistoryFormatter();
  let reads = 0;
  for (let i = 0; i < 200; i++) {
    const command = {type: 'commandExecution', id: `cmd-${i}`, command: 'check', cwd: '/p', status: 'completed', exitCode: 0,
      get aggregatedOutput() {reads++; return 'long output line\n'.repeat(100);}};
    item(rpc, command);
  }
  item(rpc, {...agent('answer', ''), get text() {reads++; return 'Stable answer';}});
  formatter.conversation(session.state, 80);
  formatter.details(session.state, 80);
  reads = 0;
  for (let i = 0; i < 20; i++) {
    rpc.event('item/commandExecution/outputDelta', {itemId: 'new', delta: `live ${i}\n`});
    const chat = formatter.conversation(session.state, 80);
    const technical = formatter.details(session.state, 80);
    assert.ok(technical.length > 20_000);
    assert.ok(technical.slice(technical.length - 10, technical.length).length <= 10);
    assert.match(chat.slice(0, chat.length).join('\n'), /Stable answer/);
  }
  assert.equal(reads, 0, 'unchanged history must not be read or reformatted on incoming events');
});
