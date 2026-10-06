import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shortcutHints} from '../src/view.js';

test('shortcut hints fit complete labels, including wide characters', () => {
  assert.equal(shortcutHints(5, ['abcdef', '界', 'x']), '界');
  assert.equal(shortcutHints(6, ['界', 'x']), '界 · x');
  assert.equal(shortcutHints(0, ['hint']), '');
});
