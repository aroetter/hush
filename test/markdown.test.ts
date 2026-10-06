import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stripVTControlCharacters as plain} from 'node:util';
import {Chalk} from 'chalk';
import stringWidth from 'string-width';
import {markdown} from '../src/markdown.js';

const colors = new Chalk({level: 1});
const noColor = new Chalk({level: 0});

test('Markdown renders headings, emphasis, lists and literal code', () => {
  const output = markdown('# Heading\n\n**Bold** and *italic* with `code`.\n\n- first\n- second\n\n```ts\nconst raw = "**literal**";\n```', 60, colors).join('\n');
  assert.match(output, /\x1b\[1mHeading/);
  assert.match(output, /\x1b\[1mBold/);
  assert.match(output, /\x1b\[3mitalic/);
  assert.match(plain(output), /• first\n• second/);
  assert.match(plain(output), /const raw = "\*\*literal\*\*";/);
  assert.doesNotMatch(plain(output), /```|# Heading|\*\*Bold\*\*/);
});

test('tables wrap inline link destinations to fit narrow terminals', () => {
  const source = '| File | Change |\n| --- | --- |\n| [app.ts](/very/long/path/app.ts:12) | **fixed** 界界界界 |';
  for (const width of [10, 15, 34, 79]) {
    const output = markdown(source, width, colors);
    assert.ok(output.every(line => stringWidth(line) <= width), `width ${width}`);
    const text = plain(output.join('\n'));
    if (width === 79) {
      assert.match(text, /app.ts \(\/very\/long\/path\/app.ts:12\)/);
      assert.doesNotMatch(text, /\[1\]|1\. \/very/);
    }
  }
});

test('streaming partial Markdown and nested lists remain readable without color', () => {
  for (const source of ['**partial', '[link](', '```ts\nconst x', '- outer\n  - inner', '> quote']) {
    const output = markdown(source, 34, noColor).join('\n');
    assert.ok(output.length);
    assert.doesNotMatch(output, /\x1b/);
  }
  assert.match(markdown('- outer\n  - inner', 34, noColor).join('\n'), /• outer\n  • inner/);
});

test('untrusted terminal controls are removed before rendering', () => {
  const output = markdown('\x1b[31mred\x1b[0m\x1b]52;c;payload\x07\n[link](https://example.com)', 60, noColor).join('\n');
  assert.doesNotMatch(output, /\x1b|payload/);
  assert.match(output, /red/);
  assert.match(output, /https:\/\/example.com/);
});

test('wrapped emphasis is balanced on each line for independent scrolling', () => {
  const output = markdown('**one two three four five six seven**', 10, colors);
  assert.ok(output.length > 1);
  for (const line of output) {
    assert.match(line, /\x1b\[1m/);
    assert.match(line, /\x1b\[22m/);
  }
});

test('user text stays literal and has a distinct color from assistant Markdown', async () => {
  const {ready, item, agent} = await import('./helpers.js');
  const {conversationLines} = await import('../src/view.js');
  const {session, rpc} = await ready();
  item(rpc, {type: 'userMessage', id: 'user-1', content: [{type: 'text', text: '**literal prompt**'}]});
  item(rpc, agent('answer-1', '**formatted reply**'));
  const output = conversationLines(session.state, 60, colors).join('\n');
  assert.match(output, /\x1b\[36m/);
  assert.match(output, /\x1b\[37m/);
  assert.match(plain(output), /\*\*literal prompt\*\*/);
  assert.doesNotMatch(plain(output), /\*\*formatted reply\*\*/);
});


test('numbered instructions keep each URL in its own step without added footnotes', () => {
  const source = '1. Open [recordings](http://localhost:8000/recordings).\n2. Open [review](http://localhost:8000/review).\n3. Try <https://example.com>.';
  const output = markdown(source, 100, noColor).join('\n');
  assert.equal(output, '1. Open recordings (http://localhost:8000/recordings).\n2. Open review (http://localhost:8000/review).\n3. Try https://example.com.');
  assert.doesNotMatch(output, /\[1\]|\[2\]/);
});
