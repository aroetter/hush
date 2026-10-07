import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shortcutHints, details} from '../src/view.js';
import {ready, item} from './helpers.js';

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
