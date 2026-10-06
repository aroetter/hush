/** Render Markdown as terminal text; only locally generated ANSI escapes are allowed. */
import chalk, {type ChalkInstance} from 'chalk';
import {marked, type Token} from 'marked';
import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import {clean} from './terminal.js';

export function markdown(text: string, width: number, colors: ChalkInstance = chalk): string[] {
  width = Math.max(1, width);
  const wrap = (value: string, size: number) => wrapAnsi(value.replace(/\t/g, '    '), Math.max(1, size), {hard: true, trim: false}).split('\n');
  const inline = (tokens: Token[]): string => tokens.map(token => {
    switch (token.type) {
      case 'strong': return colors.bold(inline(token.tokens ?? []));
      case 'em': return colors.italic(inline(token.tokens ?? []));
      case 'del': return colors.strikethrough(inline(token.tokens ?? []));
      case 'codespan': return colors.yellow(token.text);
      case 'br': return '\n';
      case 'link': case 'image': {
        const label = inline(token.tokens ?? []) || token.text || token.href;
        if (label === token.href) return colors.underline(label);
        return colors.underline(label) + ' ' + colors.cyan(`(${token.href})`);
      }
      default: return 'tokens' in token && token.tokens ? inline(token.tokens) : 'text' in token ? token.text : token.raw;
    }
  }).join('');
  const blocks = (tokens: Token[], size: number): string[] => tokens.flatMap((token): string[] => {
    switch (token.type) {
      case 'space': case 'def': return [];
      case 'heading': return [...wrap(colors.bold(inline(token.tokens ?? [])), size), ''];
      case 'paragraph': return [...wrap(inline(token.tokens ?? [token]), size), ''];
      case 'text': return wrap(inline(token.tokens ?? [token]), size);
      case 'hr': return [colors.gray('─'.repeat(size)), ''];
      case 'code': return [colors.gray(token.lang ? `┌ ${token.lang}` : '┌'), ...wrap(token.text, Math.max(1, size - 2)).map(line => colors.gray('│ ') + line), ''].flatMap(line => wrap(line, size));
      case 'blockquote': return [...blocks(token.tokens ?? [], Math.max(1, size - 2)).map(line => colors.gray('│ ') + line).flatMap(line => wrap(line, size)), ''];
      case 'list': {
        return [...token.items.flatMap((item: {tokens: Token[]; task: boolean; checked?: boolean}, i: number) => {
          const prefix = item.task ? (item.checked ? '☑ ' : '☐ ') : token.ordered ? `${Number(token.start) + i}. ` : '• ';
          const body = blocks(item.tokens, Math.max(1, size - stringWidth(prefix)));
          while (body.at(-1) === '') body.pop();
          return body.map((line, n) => (n ? ' '.repeat(stringWidth(prefix)) : prefix) + line).flatMap(line => wrap(line, size));
        }), ''];
      }
      case 'table': {
        const headers: string[] = token.header.map((cell: {tokens: Token[]}) => inline(cell.tokens));
        const rows: string[][] = token.rows.map((row: {tokens: Token[]}[]) => row.map(cell => inline(cell.tokens)));
        const cellWidth = Math.floor((size - 3 * (headers.length - 1)) / headers.length);
        if (cellWidth < 12) return [...rows.flatMap(row => [...row.flatMap((cell, i) => wrap(`${colors.bold(headers[i])}: ${cell}`, size)), ''])];
        const renderRow = (row: string[], header: boolean): string[] => {
          const cells = row.map(cell => wrap(header ? colors.bold(cell) : cell, cellWidth));
          return Array.from({length: Math.max(...cells.map(cell => cell.length))}, (_, n) => cells.map(cell => {
            const value = cell[n] ?? '';
            return value + ' '.repeat(Math.max(0, cellWidth - stringWidth(value)));
          }).join(colors.gray(' │ ')));
        };
        return [...renderRow(headers, true), colors.gray(headers.map(() => '─'.repeat(cellWidth)).join('─┼─')), ...rows.flatMap(row => renderRow(row, false)), ''];
      }
      default: return [...wrap('text' in token ? token.text : token.raw, size), ''];
    }
  });
  const result = blocks(marked.lexer(clean(text)), width);
  while (result.at(-1) === '') result.pop();
  return result.map(line => colors.white(line));
}
