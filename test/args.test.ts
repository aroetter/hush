/** CLI contracts: supported flags, repeated configuration, and explicit rejection of mistakes. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOptions} from '../src/args.js';

test('model and repeated TOML config work before and after resume', () => {
  const args = parseOptions(['-c', 'model_reasoning_effort=high', '-m', 'test', 'resume', 'session', '-c', 'features.foo=true', '-c', 'limits=[1,2]'], '/work');
  assert.deepEqual(args.resume, {id: 'session'});
  assert.equal(args.model, 'test');
  assert.equal(args.cwd, '/work');
  assert.deepEqual(args.overrides, {model_reasoning_effort: 'high', 'features.foo': true, limits: [1, 2]});
});
test('picker, latest, and all sessions are explicit', () => {
  assert.equal(parseOptions(['resume']).resume, 'picker');
  assert.equal(parseOptions(['resume', '--last']).resume, 'last');
  assert.equal(parseOptions(['resume', '--all']).all, true);
  assert.equal(parseOptions(['hello']).prompt, 'hello');
});
test('unsupported and conflicting flags fail instead of disappearing', () => {
  for (const args of [['-C', '/tmp'], ['--sandbox', 'read-only'], ['--last'], ['resume', 'id', '--last'], ['-c', 'bad'], ['hello', 'world']]) assert.throws(() => parseOptions(args));
});
